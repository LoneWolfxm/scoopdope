import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { STELLAR_HORIZON_TIMEOUT_MS } from '../health.constants';

@Injectable()
export class StellarHealthIndicator extends HealthIndicator {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async check(key = 'stellar'): Promise<HealthIndicatorResult> {
    const baseUrl =
      this.configService.get<string>('health.stellarHorizonUrl') ||
      'https://horizon-testnet.stellar.org';
    const healthUrl = new URL('/health', baseUrl).toString();
    const start = Date.now();

    try {
      const response = await axios.get(healthUrl, { timeout: STELLAR_HORIZON_TIMEOUT_MS });
      const latencyMs = Date.now() - start;
      if (response.status !== 200) {
        throw new Error(`Horizon returned HTTP ${response.status}`);
      }

      return this.getStatus(key, true, { latencyMs });
    } catch (error) {
      const latencyMs = Date.now() - start;
      const message = error instanceof Error ? error.message : 'Unknown Horizon error';
      throw new HealthCheckError(
        'Stellar Horizon health check failed',
        this.getStatus(key, false, { latencyMs, message })
      );
    }
  }
}