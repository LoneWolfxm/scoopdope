import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, MemoryHealthIndicator, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Cache } from 'cache-manager';
import { Logger } from 'winston';
import { HealthService } from './health.service';
import { StellarHealthIndicator } from './indicators/stellar.health';

type HorizonMode = 'healthy' | 'unhealthy' | 'timeout';

describe('HealthService Stellar Horizon integration', () => {
  let server: Server;
  let horizonUrl: string;
  let horizonMode: HorizonMode;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      if (horizonMode === 'timeout') return;
      response.writeHead(horizonMode === 'healthy' ? 200 : 503);
      response.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    horizonUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  function createService(stellarCritical = true): HealthService {
    const cacheValues = new Map<string, unknown>();
    const cacheManager = {
      get: jest.fn(async (key: string) => cacheValues.get(key) ?? null),
      set: jest.fn(async (key: string, value: unknown) => {
        cacheValues.set(key, value);
      }),
    };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'nodeEnv') return 'test';
        if (key === 'health.stellarCritical') return stellarCritical;
        if (key === 'health.stellarHorizonUrl') return horizonUrl;
        return undefined;
      }),
    };
    const stellarIndicator = new StellarHealthIndicator(configService as unknown as ConfigService);

    return new HealthService(
      {} as HealthCheckService,
      { pingCheck: jest.fn().mockResolvedValue({}) } as unknown as TypeOrmHealthIndicator,
      {
        checkHeap: jest.fn().mockResolvedValue({}),
        checkRSS: jest.fn().mockResolvedValue({}),
      } as unknown as MemoryHealthIndicator,
      stellarIndicator,
      cacheManager as unknown as Cache,
      { debug: jest.fn(), info: jest.fn() } as unknown as Logger,
      configService as unknown as ConfigService
    );
  }

  it('reports Stellar as up when Horizon responds successfully', async () => {
    horizonMode = 'healthy';

    const result = await createService().checkFull();

    expect(result.checks.stellar).toMatchObject({ status: 'up' });
    expect(result.status).toBe('ok');
  });

  it('reflects a Horizon outage as down and fails when configured as critical', async () => {
    horizonMode = 'unhealthy';

    const result = await createService().checkFull();

    expect(result.checks.stellar).toMatchObject({ status: 'down' });
    expect(result.status).toBe('error');
  });

  it('reflects a new outage on the next check without serving a stale cached status', async () => {
    const healthService = createService();
    horizonMode = 'healthy';
    expect((await healthService.checkFull()).checks.stellar.status).toBe('up');

    horizonMode = 'unhealthy';
    const result = await healthService.checkFull();

    expect(result.checks.stellar).toMatchObject({ status: 'down' });
    expect(result.status).toBe('error');
  });

  it('keeps the overall check healthy when Stellar is configured as warning-only', async () => {
    horizonMode = 'unhealthy';

    const result = await createService(false).checkFull();

    expect(result.checks.stellar).toMatchObject({ status: 'down' });
    expect(result.status).toBe('ok');
  });

  it('times out an unresponsive Horizon within three seconds', async () => {
    horizonMode = 'timeout';
    const startedAt = Date.now();

    const result = await createService().checkFull();

    expect(result.checks.stellar).toMatchObject({ status: 'down' });
    expect(result.status).toBe('error');
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });
});
