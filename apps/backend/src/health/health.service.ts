import {
  Injectable,
  Inject,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { HealthCheckService, TypeOrmHealthIndicator, MemoryHealthIndicator } from '@nestjs/terminus';
import { StellarHealthIndicator } from './indicators/stellar.health';
import { Gauge } from 'prom-client';
import {
  HEALTH_CACHE_TTL_MS,
  MEMORY_HEAP_THRESHOLD_BYTES,
  MEMORY_RSS_THRESHOLD_BYTES,
} from './health.constants';
import { HealthSystemInfo, HealthEnvironmentInfo, ProbeResult, ProbeCheckResult } from './health.types';

@Injectable()
export class HealthService implements OnModuleInit {
  private readonly startTime = new Date();
  private readonly appVersion: string;
  private readonly nodeEnv: string;
  private readonly environmentName: string;
  private readonly stellarCritical: boolean;
  private isShuttingDown = false;

  private readonly healthGauge: Gauge<string>;

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly stellar: StellarHealthIndicator,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {
    this.appVersion = process.env.npm_package_version || '1.0.0';
    this.nodeEnv = this.configService.get<string>('nodeEnv') || 'development';
    this.environmentName = process.env.ENVIRONMENT_NAME || this.nodeEnv;
    this.stellarCritical = this.configService.get<boolean>('health.stellarCritical') ?? true;

    this.healthGauge = new Gauge({
      name: 'health_check_status',
      help: 'Health check status per probe type (1=up, 0=down)',
      labelNames: ['probe'],
      registers: [],
    });
  }

  onModuleInit() {
    try {
      const { register } = require('prom-client');
      register.registerMetric(this.healthGauge);
    } catch {
    }
  }

  get isHealthy(): boolean {
    return !this.isShuttingDown;
  }

  setShuttingDown(value: boolean) {
    this.isShuttingDown = value;
  }

  getSystemInfo(): HealthSystemInfo {
    return {
      version: this.appVersion,
      uptime: process.uptime(),
      environment: this.nodeEnv,
      nodeVersion: process.version,
      platform: process.platform,
      memoryUsage: process.memoryUsage(),
      cpuLoad: process.cpuUsage() ? [0] : [0],
      startTime: this.startTime.toISOString(),
      environmentName: this.environmentName,
    };
  }

  getEnvironmentInfo(): HealthEnvironmentInfo {
    return {
      active: this.environmentName,
      inactive: this.environmentName === 'blue' ? 'green' : 'blue',
      region: process.env.AWS_REGION || 'local',
      timestamp: new Date().toISOString(),
    };
  }

  async checkLiveness(): Promise<ProbeResult> {
    const status = this.isShuttingDown ? 'error' : 'ok';
    const checks: Record<string, ProbeCheckResult> = {
      process: {
        status: this.isShuttingDown ? 'down' : 'up',
        message: this.isShuttingDown ? 'Shutting down' : 'Process alive',
      },
    };
    return { status, timestamp: new Date().toISOString(), checks };
  }

  async checkReadiness(): Promise<ProbeResult> {
    if (this.isShuttingDown) {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        checks: {
          process: { status: 'down', message: 'Shutting down' },
        },
      };
    }

    const result: ProbeResult = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks: {},
    };

    await this.withCache('readiness-db', async () => {
      try {
        await this.db.pingCheck('database', { timeout: 3000 });
        result.checks['database'] = { status: 'up' };
      } catch {
        result.checks['database'] = { status: 'down', message: 'Database unreachable' };
        result.status = 'error';
      }
    });

    await this.withCache('readiness-redis', async () => {
      const redisResult = await this.checkRedis();
      result.checks['redis'] = redisResult;
      if (redisResult.status !== 'up') {
        result.status = 'error';
      }
    });

    return result;
  }

  async checkStartup(): Promise<ProbeResult> {
    const checks: Record<string, ProbeCheckResult> = {
      initialized: {
        status: 'up',
        message: `Started at ${this.startTime.toISOString()}`,
      },
      uptime: {
        status: 'up',
        message: `${Math.floor(process.uptime())}s`,
      },
    };
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  async checkFull(): Promise<ProbeResult> {
    const result: ProbeResult = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks: {},
    };

    await this.withCache('full-db', async () => {
      try {
        await this.db.pingCheck('database', { timeout: 5000 });
        result.checks['database'] = { status: 'up' };
      } catch {
        result.checks['database'] = { status: 'down', message: 'Database unreachable' };
        result.status = 'error';
      }
    });

    await this.withCache('full-redis', async () => {
      const redisResult = await this.checkRedis();
      result.checks['redis'] = redisResult;
      if (redisResult.status !== 'up') {
        result.status = 'error';
      }
    });

    let stellarResult: ProbeCheckResult;
    try {
      const stellarCheck = await this.stellar.check('stellar');
      const details = stellarCheck['stellar'];
      stellarResult = {
        status: 'up',
        latencyMs: typeof details?.latencyMs === 'number' ? details.latencyMs : undefined,
      };
    } catch {
      stellarResult = { status: 'down', message: 'Stellar Horizon is unreachable' };
    }
    result.checks['stellar'] = stellarResult;
    if (stellarResult.status === 'down' && this.stellarCritical) {
      result.status = 'error';
    }

    await this.withCache('full-memory-heap', async () => {
      try {
        await this.memory.checkHeap('memory_heap', MEMORY_HEAP_THRESHOLD_BYTES);
        result.checks['memory_heap'] = { status: 'up' };
      } catch {
        result.checks['memory_heap'] = { status: 'degraded', message: 'Heap usage high' };
      }
    });

    await this.withCache('full-memory-rss', async () => {
      try {
        await this.memory.checkRSS('memory_rss', MEMORY_RSS_THRESHOLD_BYTES);
        result.checks['memory_rss'] = { status: 'up' };
      } catch {
        result.checks['memory_rss'] = { status: 'degraded', message: 'RSS usage high' };
      }
    });

    this.healthGauge.set({ probe: 'full' }, result.status === 'ok' ? 1 : 0);
    this.healthGauge.set({ probe: 'readiness' }, result.status === 'ok' ? 1 : 0);

    return result;
  }

  private async checkRedis(): Promise<ProbeCheckResult> {
    const key = 'health-check';
    const testValue = Date.now().toString();
    const start = Date.now();

    try {
      await this.cacheManager.set(key, testValue, 1000);
      const retrieved = await this.cacheManager.get(key);
      const latencyMs = Date.now() - start;

      if (retrieved === testValue) {
        return { status: 'up', latencyMs };
      }
      return { status: 'down', message: 'Redis value mismatch', latencyMs };
    } catch (error: any) {
      return { status: 'down', message: error.message, latencyMs: Date.now() - start };
    }
  }

  private async withCache<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.cacheManager.get<T>(`health:${cacheKey}`);
      if (cached !== null && cached !== undefined) {
        return cached;
      }
    } catch {
    }

    const result = await fn();

    try {
      await this.cacheManager.set(`health:${cacheKey}`, result, HEALTH_CACHE_TTL_MS);
    } catch {
    }

    return result;
  }
}
