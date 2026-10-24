import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { HealthCheckService, TypeOrmHealthIndicator, MemoryHealthIndicator } from '@nestjs/terminus';
import { HealthService } from '../health.service';
import { StellarHealthIndicator } from '../indicators/stellar.health';

describe('HealthService', () => {
  let service: HealthService;
  let mockHealthCheckService: jest.Mocked<HealthCheckService>;
  let mockDb: jest.Mocked<TypeOrmHealthIndicator>;
  let mockMemory: jest.Mocked<MemoryHealthIndicator>;
  let mockStellar: jest.Mocked<StellarHealthIndicator>;
  let mockCacheManager: jest.Mocked<any>;
  let mockLogger: jest.Mocked<any>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockHealthCheckService = {
      check: jest.fn(),
    } as any;

    mockDb = {
      pingCheck: jest.fn(),
    } as any;

    mockMemory = {
      checkHeap: jest.fn(),
      checkRSS: jest.fn(),
    } as any;

    mockStellar = {
      check: jest.fn(),
    } as any;

    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'nodeEnv') return 'test';
        return undefined;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: mockDb },
        { provide: MemoryHealthIndicator, useValue: mockMemory },
        { provide: StellarHealthIndicator, useValue: mockStellar },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  describe('checkLiveness', () => {
    it('should return ok when process is alive', async () => {
      const result = await service.checkLiveness();
      expect(result.status).toBe('ok');
      expect(result.checks.process.status).toBe('up');
    });

    it('should return error when shutting down', async () => {
      service.setShuttingDown(true);
      const result = await service.checkLiveness();
      expect(result.status).toBe('error');
      expect(result.checks.process.status).toBe('down');
    });
  });

  describe('checkStartup', () => {
    it('should return ok with uptime info', async () => {
      const result = await service.checkStartup();
      expect(result.status).toBe('ok');
      expect(result.checks.initialized.status).toBe('up');
      expect(result.checks.uptime.status).toBe('up');
    });
  });

  describe('getSystemInfo', () => {
    it('should return system information', () => {
      const info = service.getSystemInfo();
      expect(info.version).toBeDefined();
      expect(info.uptime).toBeGreaterThanOrEqual(0);
      expect(info.environment).toBe('test');
      expect(info.nodeVersion).toBeDefined();
      expect(info.platform).toBeDefined();
      expect(info.memoryUsage).toBeDefined();
      expect(info.startTime).toBeDefined();
    });
  });

  describe('getEnvironmentInfo', () => {
    it('should return environment info with default', () => {
      const info = service.getEnvironmentInfo();
      expect(info.active).toBe('test');
      expect(info.inactive).toBe('blue');
      expect(info.region).toBe('local');
    });

    it('should return environment info', () => {
      const info = service.getEnvironmentInfo();
      expect(info.active).toBe('test');
      expect(info.inactive).toBe('blue');
      expect(info.region).toBe('local');
    });
  });

  describe('checkReadiness', () => {
    it('should return error when shutting down', async () => {
      service.setShuttingDown(true);
      const result = await service.checkReadiness();
      expect(result.status).toBe('error');
    });

    it('should return ok when dependencies are healthy', async () => {
      mockDb.pingCheck.mockResolvedValue({ database: { status: 'up' } } as any);
      mockCacheManager.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(Date.now().toString());
      mockCacheManager.set.mockResolvedValue(undefined);

      const result = await service.checkReadiness();
      expect(result.status).toBe('ok');
    });
  });

  describe('checkFull', () => {
    it('should include all health checks', async () => {
      mockDb.pingCheck.mockResolvedValue({ database: { status: 'up' } } as any);
      mockCacheManager.get
        .mockResolvedValue(null)
        .mockResolvedValue(null)
        .mockResolvedValue(null)
        .mockResolvedValue(null);
      mockCacheManager.set.mockResolvedValue(undefined);
      mockMemory.checkHeap.mockResolvedValue({ memory_heap: { status: 'up' } } as any);
      mockMemory.checkRSS.mockResolvedValue({ memory_rss: { status: 'up' } } as any);
      mockStellar.check.mockResolvedValue({
        stellar: { status: 'up', latencyMs: 12 },
      } as any);

      const result = await service.checkFull();
      expect(result.checks.database).toBeDefined();
      expect(result.checks.redis).toBeDefined();
      expect(result.checks.memory_heap).toBeDefined();
      expect(result.checks.memory_rss).toBeDefined();
      expect(result.checks.stellar).toMatchObject({ status: 'up', latencyMs: 12 });
      expect(mockStellar.check).toHaveBeenCalledWith('stellar');
    });

    it('should fail the full health check when Stellar is unreachable', async () => {
      mockDb.pingCheck.mockResolvedValue({ database: { status: 'up' } } as any);
      mockCacheManager.get.mockResolvedValue(null);
      mockCacheManager.set.mockResolvedValue(undefined);
      mockMemory.checkHeap.mockResolvedValue({ memory_heap: { status: 'up' } } as any);
      mockMemory.checkRSS.mockResolvedValue({ memory_rss: { status: 'up' } } as any);
      mockStellar.check.mockRejectedValue(new Error('RPC unavailable'));

      const result = await service.checkFull();

      expect(result.status).toBe('error');
      expect(result.checks.stellar).toEqual({
        status: 'down',
        message: 'Stellar Horizon is unreachable',
      });
    });
  });
});
