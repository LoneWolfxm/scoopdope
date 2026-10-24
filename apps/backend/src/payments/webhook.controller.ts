import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

@Controller('api/v1/payments')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature: string | undefined,
  ): Promise<{ received: boolean }> {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.error('PAYMENT_WEBHOOK_SECRET is not configured');
      throw new UnauthorizedException('Webhook signature verification is not configured');
    }

    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!this.safeCompare(expected, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    this.logger.log(`Received verified payment webhook event: ${payload?.type ?? 'unknown'}`);

    return { received: true };
  }

  private safeCompare(expected: string, provided: string): boolean {
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, providedBuf);
  }
}
