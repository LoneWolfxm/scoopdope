import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { STELLAR_SOROBAN_TIMEOUT_MS } from '../health.constants';

@Injectable()
export class StellarSorobanHealthIndicator extends HealthIndicator {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const sorobanUrl =
      this.configService.get<string>('stellar.sorobanRpcUrl') ||
      'https://soroban-testnet.stellar.org';

    try {
      const { default: axios } = await import('axios');
      const start = Date.now();

      const response = await axios.post(
        sorobanUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getHealth',
        },
        { timeout: STELLAR_SOROBAN_TIMEOUT_MS },
      );

      const latencyMs = Date.now() - start;
      const data = response.data;

      const healthy = response.status === 200 && data?.result?.status === 'healthy';

      if (healthy) {
        return this.getStatus(key, true, {
          url: sorobanUrl,
          status: data?.result?.status || 'ok',
          latencyMs,
        });
      }

      throw new HealthCheckError(
        'Soroban RPC unhealthy',
        this.getStatus(key, false, {
          url: sorobanUrl,
          status: data?.result?.status || 'unknown',
          latencyMs,
        }),
      );
    } catch (error: any) {
      if (error instanceof HealthCheckError) throw error;
      throw new HealthCheckError(
        'Soroban RPC health check failed',
        this.getStatus(key, false, { url: sorobanUrl, message: error.message }),
      );
    }
  }
}
