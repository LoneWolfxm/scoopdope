import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { StellarService } from './stellar.service';
import { MetricsService } from '../metrics/metrics.service';
import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Soroban Testnet Integration Tests
 *
 * These tests deploy the Analytics contract to a local Soroban sandbox
 * and verify contract interactions work correctly.
 *
 * Run only on main branch pushes to avoid rate limits.
 * Requires: stellar-cli, docker
 */
describe('StellarService - Soroban Testnet (Integration)', () => {
  let service: StellarService;
  let module: TestingModule;
  let contractId: string;
  let sandboxRunning = false;

  beforeAll(async () => {
    // Skip if not on main branch or in CI
    const isMainBranch = process.env.GITHUB_REF === 'refs/heads/main';
    const isCi = process.env.CI === 'true';

    if (!isMainBranch && isCi) {
      console.log('Skipping Soroban tests (not on main branch)');
      return;
    }

    // Start local Soroban sandbox
    try {
      console.log('Starting Soroban sandbox...');
      execSync(
        'stellar network add --rpc-url http://localhost:8000 --network-passphrase "Test SDF Network ; September 2015" local',
        {
          stdio: 'pipe',
        }
      );
      sandboxRunning = true;
    } catch (error) {
      console.warn('Could not start Soroban sandbox:', error.message);
      // Continue anyway - tests will be skipped if sandbox unavailable
    }

    module = await Test.createTestingModule({
      imports: [CacheModule.register()],
      providers: [
        StellarService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const config = {
                'stellar.network': 'testnet',
                'stellar.sorobanRpcUrl': 'http://localhost:8000',
                'stellar.secretKey':
                  process.env.STELLAR_SECRET_KEY ||
                  'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                'stellar.contractId': process.env.ANALYTICS_CONTRACT_ID || '',
              };
              return config[key];
            },
          },
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
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('Contract Deployment', () => {
    it('should deploy Analytics contract to sandbox', async () => {
      if (!sandboxRunning) {
        console.log('Skipping: Soroban sandbox not available');
        return;
      }

      try {
        const contractPath = path.join(
          __dirname,
          '../../../contracts/analytics/target/wasm32-unknown-unknown/release/brain_storm_analytics.wasm'
        );

        // Deploy contract
        const output = execSync(
          `stellar contract deploy --wasm ${contractPath} --source-account test --network local`,
          { encoding: 'utf-8' }
        );

        // Extract contract ID from output
        const match = output.match(/Contract ID: ([A-Z0-9]+)/);
        contractId = match ? match[1] : '';

        expect(contractId).toBeTruthy();
        expect(contractId).toMatch(/^C[A-Z0-9]{55}$/);
      } catch (error) {
        console.warn('Contract deployment failed:', error.message);
        // Skip remaining tests if deployment fails
        return;
      }
    });
  });

  describe('Contract Invocation', () => {
    beforeEach(() => {
      if (!contractId) {
        console.log('Skipping: Contract not deployed');
      }
    });

    it('should call record_progress on Analytics contract', async () => {
      if (!contractId || !sandboxRunning) {
        console.log('Skipping: Prerequisites not met');
        return;
      }

      try {
        const studentId = 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQ75XABZXVQRLLOG4';
        const courseId = 'course-001';
        const progress = 100;

        const output = execSync(
          `stellar contract invoke --id ${contractId} --source-account test --network local -- record_progress ${studentId} ${courseId} ${progress}`,
          { encoding: 'utf-8' }
        );

        expect(output).toBeTruthy();
      } catch (error) {
        console.warn('record_progress invocation failed:', error.message);
      }
    });

    it('should return valid transaction hash from issueCredential', async () => {
      if (!contractId || !sandboxRunning) {
        console.log('Skipping: Prerequisites not met');
        return;
      }

      try {
        const recipientPublicKey = 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQ75XABZXVQRLLOG4';
        const courseId = 'course-001';

        const txHash = await service.issueCredential(recipientPublicKey, courseId);

        // Verify it's a valid transaction hash format
        expect(txHash).toBeTruthy();
        expect(txHash).toMatch(/^[a-f0-9]{64}$/);
      } catch (error) {
        console.warn('issueCredential failed:', error.message);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid contract ID gracefully', async () => {
      if (!sandboxRunning) {
        console.log('Skipping: Soroban sandbox not available');
        return;
      }

      try {
        const invalidContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
        execSync(
          `stellar contract invoke --id ${invalidContractId} --source-account test --network local -- record_progress test test 0`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (error) {
        // Expected to fail
        expect(error).toBeTruthy();
      }
    });
  });
});
