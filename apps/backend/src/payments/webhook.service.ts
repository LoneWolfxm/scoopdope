import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

export interface PaymentWebhookEvent {
  id: string;
  type: string;
  data: Record<string, any>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  /**
   * Verify the HMAC-SHA256 signature of an incoming payment webhook.
   * The signing secret is read from PAYMENT_WEBHOOK_SECRET.
   * Throws UnauthorizedException when the signature is missing or invalid.
   */
  verifySignature(rawBody: string | Buffer, signature: string | undefined): void {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.error('PAYMENT_WEBHOOK_SECRET is not configured');
      throw new UnauthorizedException('Webhook signing secret not configured');
    }

    if (!signature || typeof signature !== 'string') {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? '', 'utf8');
    const expected = createHmac('sha256', secret).update(payload).digest('hex');

    const provided = signature.trim().replace(/^sha256=/, '');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');

    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  /**
   * Verify the signature and process the webhook event.
   */
  async handleWebhook(
    rawBody: string | Buffer,
    signature: string | undefined,
  ): Promise<{ received: boolean }> {
    this.verifySignature(rawBody, signature);

    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    let event: PaymentWebhookEvent;
    try {
      event = JSON.parse(payload);
    } catch {
      throw new UnauthorizedException('Invalid webhook payload');
    }

    this.logger.log(`Processing verified payment webhook event: ${event?.id} (${event?.type})`);
    await this.processEvent(event);

    return { received: true };
  }

  protected async processEvent(event: PaymentWebhookEvent): Promise<void> {
    // Existing payment event handling is delegated here.
    this.logger.debug(`Handled payment event ${event?.id}`);
  }
}
