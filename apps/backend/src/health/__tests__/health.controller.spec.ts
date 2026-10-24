import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator, MemoryHealthIndicator, HttpHealthIndicator } from '@nestjs/terminus';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import { HealthController } from '../health.controller';
import { HealthService } from '../health.service';
import { ServiceUnavailableException } from '@nestjs/common';
import { DiskHealthIndicator } from '../indicators/disk.health';
import { ElasticsearchHealthIndicator } from '../indicators/elasticsearch.health';
import { StellarSorobanHealthIndicator } from '../indicators/stellar-soroban.health';

import { ProbeResult } from '../health.types';

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthService: jest.Mocked<HealthService>;

  const okResult: ProbeResult = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {},
  };

  beforeEach(async () => {
    mockHealthService = {
      checkLiveness: jest.fn(),
      checkReadiness: jest.fn(),
      checkStartup: jest.fn(),
      checkFull: jest.fn(),
      getSystemInfo: jest.fn(),
      getEnvironmentInfo: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: mockHealthService },
        { provide: HealthCheckService, useValue: { check: jest.fn() } },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck: jest.fn() } },
        { provide: MemoryHealthIndicator, useValue: { checkHeap: jest.fn(), checkRSS: jest.fn() } },
        { provide: HttpHealthIndicator, useValue: { pingCheck: jest.fn() } },
        { provide: DiskHealthIndicator, useValue: { check: jest.fn() } },
        { provide: ElasticsearchHealthIndicator, useValue: { check: jest.fn() } },
        { provide: StellarSorobanHealthIndicator, useValue: { check: jest.fn() } },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn() } },
        { provide: WINSTON_MODULE_PROVIDER, useValue: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://horizon-testnet.stellar.org') },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('check', () => {
    it('should delegate to the full health service check', async () => {
      mockHealthService.checkFull.mockResolvedValue(okResult);

      await expect(controller.check()).resolves.toEqual(okResult);
      expect(mockHealthService.checkFull).toHaveBeenCalled();
    });

    it('should return service unavailable when a critical dependency is down', async () => {
      mockHealthService.checkFull.mockResolvedValue({
        status: 'error',
        timestamp: new Date().toISOString(),
        checks: { stellar: { status: 'down', message: 'Stellar Horizon is unreachable' } },
      });

      await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('checkLiveness', () => {
    it('should delegate to health service', async () => {
      const expected: ProbeResult = { status: 'ok', timestamp: new Date().toISOString(), checks: { process: { status: 'up' } } };
      mockHealthService.checkLiveness.mockResolvedValue(expected);

      const result = await controller.checkLiveness();
      expect(result).toEqual(expected);
      expect(mockHealthService.checkLiveness).toHaveBeenCalled();
    });
  });

  describe('checkReadiness', () => {
    it('should delegate to health service', async () => {
      const expected: ProbeResult = { status: 'ok', timestamp: new Date().toISOString(), checks: {} };
      mockHealthService.checkReadiness.mockResolvedValue(expected);

      const result = await controller.checkReadiness();
      expect(result).toEqual(expected);
      expect(mockHealthService.checkReadiness).toHaveBeenCalled();
    });
  });

  describe('checkStartup', () => {
    it('should delegate to health service', async () => {
      const expected: ProbeResult = { status: 'ok', timestamp: new Date().toISOString(), checks: { initialized: { status: 'up' } } };
      mockHealthService.checkStartup.mockResolvedValue(expected);

      const result = await controller.checkStartup();
      expect(result).toEqual(expected);
      expect(mockHealthService.checkStartup).toHaveBeenCalled();
    });
  });

  describe('checkEnvironment', () => {
    it('should delegate to health service', async () => {
      const expected = { active: 'blue', inactive: 'green', region: 'local', timestamp: expect.any(String) };
      mockHealthService.getEnvironmentInfo.mockReturnValue(expected);

      const result = await controller.checkEnvironment();
      expect(result).toEqual(expected);
      expect(mockHealthService.getEnvironmentInfo).toHaveBeenCalled();
    });
  });

  describe('checkVersion', () => {
    it('should delegate to health service', async () => {
      const expected = { version: '1.0.0', uptime: 100, environment: 'test' };
      mockHealthService.getSystemInfo.mockReturnValue(expected as any);

      const result = await controller.checkVersion();
      expect(result).toEqual(expected);
      expect(mockHealthService.getSystemInfo).toHaveBeenCalled();
    });
  });
});
