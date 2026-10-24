import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { StellarService } from './stellar.service';
import { MetricsService } from '../metrics/metrics.service';

describe('StellarService - Graceful Shutdown', () => {
  let service: StellarService;
  let module: TestingModule;
  let configService: ConfigService;

  beforeEach(async () => {
    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          'stellar.network': 'testnet',
          'stellar.secretKey': 'SBZVMB74Z7TTIWZNZ7CLBT6OJRZKMV4ZSM7CEGJR5ZJQSTQG5O6HBSY',
          'stellar.sorobanRpcUrl': 'https://soroban-testnet.stellar.org',
          'stellar.contractId': 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          'stellar.enrollmentContractId': '',
          'stellar.analyticsContractId': '',
          'stellar.tokenContractId': '',
          'stellar.credentialMetadataContractId': '',
          'stellar.certificateContractId': '',
        };
        return config[key];
      }),
    };

    module = await Test.createTestingModule({
      providers: [
        StellarService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCache,
        },
        {
          provide: MetricsService,
          useValue: {
            observeStellarRpcLatency: jest.fn(),
            incrementStellarRpcTimeout: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('onApplicationShutdown', () => {
    it('should complete gracefully when no transactions are pending', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.onApplicationShutdown('SIGTERM');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Shutting down StellarService')
      );
    });

    it('should wait for pending transactions during shutdown', async () => {
      const logSpy = jest.spyOn(service['logger'], 'warn');

      // Simulate pending transactions
      service['pendingTransactionCount'] = 2;

      // Simulate transactions completing after a delay
      setTimeout(() => {
        service['pendingTransactionCount'] = 0;
      }, 200);

      await service.onApplicationShutdown('SIGTERM');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('⏳ Waiting for 2 pending Stellar transaction(s)')
      );
    });

    it('should timeout and warn if transactions do not complete in time', async () => {
      const logWarnSpy = jest.spyOn(service['logger'], 'warn');

      // Simulate pending transactions that never complete
      service['pendingTransactionCount'] = 3;
      service['SHUTDOWN_TIMEOUT_MS'] = 100; // Set short timeout for testing

      await service.onApplicationShutdown('SIGTERM');

      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Shutdown timeout:')
      );
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('3 Stellar transaction(s) still pending')
      );
    });

    it('should log success when all transactions complete before timeout', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');

      // Simulate pending transactions
      service['pendingTransactionCount'] = 1;

      // Complete transaction after 50ms
      setTimeout(() => {
        service['pendingTransactionCount'] = 0;
      }, 50);

      service['SHUTDOWN_TIMEOUT_MS'] = 1000; // Long timeout

      await service.onApplicationShutdown('SIGTERM');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ All pending Stellar transactions completed')
      );
    });

    it('should handle SIGTERM, SIGINT, and custom signals', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');

      for (const signal of ['SIGTERM', 'SIGINT', 'SIGKILL', 'custom-signal']) {
        await service.onApplicationShutdown(signal);
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Shutting down StellarService (signal: ${signal})`)
        );
      }
    });
  });

  describe('Transaction tracking', () => {
    it('should increment pending transaction counter', () => {
      const initialCount = service['pendingTransactionCount'];

      service['incrementPendingTransactions']();

      expect(service['pendingTransactionCount']).toBe(initialCount + 1);
    });

    it('should decrement pending transaction counter', () => {
      service['pendingTransactionCount'] = 5;

      service['decrementPendingTransactions']();

      expect(service['pendingTransactionCount']).toBe(4);
    });

    it('should not go below zero when decrementing', () => {
      service['pendingTransactionCount'] = 0;

      service['decrementPendingTransactions']();

      expect(service['pendingTransactionCount']).toBe(0);
    });

    it('should track transaction execution and maintain counter', async () => {
      const mockAsyncFn = jest.fn().mockResolvedValue('transaction-hash-123');

      const result = await service['trackTransaction'](mockAsyncFn);

      expect(result).toBe('transaction-hash-123');
      expect(mockAsyncFn).toHaveBeenCalled();
      expect(service['pendingTransactionCount']).toBe(0);
    });

    it('should decrement counter even when transaction throws error', async () => {
      const mockError = new Error('Transaction failed');
      const mockAsyncFn = jest.fn().mockRejectedValue(mockError);

      await expect(service['trackTransaction'](mockAsyncFn)).rejects.toThrow(
        'Transaction failed'
      );

      expect(service['pendingTransactionCount']).toBe(0);
    });

    it('should properly handle concurrent transactions', async () => {
      const delayedTransaction = (delay: number) =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve(`tx-${delay}`), delay);
        });

      const promise1 = service['trackTransaction'](() => delayedTransaction(50));
      const promise2 = service['trackTransaction'](() => delayedTransaction(100));
      const promise3 = service['trackTransaction'](() => delayedTransaction(30));

      expect(service['pendingTransactionCount']).toBe(3);

      const results = await Promise.all([promise1, promise2, promise3]);

      expect(results).toContain('tx-50');
      expect(results).toContain('tx-100');
      expect(results).toContain('tx-30');
      expect(service['pendingTransactionCount']).toBe(0);
    });
  });

  describe('ensureSecretKeyConfigured', () => {
    it('should not throw when secret key is configured', () => {
      expect(() => {
        service['ensureSecretKeyConfigured']();
      }).not.toThrow();
    });

    it('should throw ServiceUnavailableException when secret key is not configured', async () => {
      const mockConfigWithoutKey = {
        get: jest.fn((key: string) => {
          const config: Record<string, any> = {
            'stellar.network': 'testnet',
            'stellar.secretKey': '',
            'stellar.sorobanRpcUrl': 'https://soroban-testnet.stellar.org',
          };
          return config[key];
        }),
      };

      module = await Test.createTestingModule({
        providers: [
          StellarService,
          {
            provide: ConfigService,
            useValue: mockConfigWithoutKey,
          },
          {
            provide: CACHE_MANAGER,
            useValue: { get: jest.fn(), set: jest.fn() },
          },
          {
            provide: MetricsService,
            useValue: {
              observeStellarRpcLatency: jest.fn(),
              incrementStellarRpcTimeout: jest.fn(),
            },
          },
        ],
      }).compile();

      service = module.get<StellarService>(StellarService);

      expect(() => {
        service['ensureSecretKeyConfigured']();
      }).toThrow('STELLAR_SECRET_KEY is not configured');
    });
  });
});
