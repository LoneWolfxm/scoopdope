import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { NotificationsService } from './notifications.service';
import { NotificationJobPayload } from './interfaces/notification-job.interface';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

@Processor('notifications')
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @Process('send-email')
  async handleSendEmail(job: Job<NotificationJobPayload>): Promise<void> {
    const idempotencyKey = this.getIdempotencyKey(job);

    const alreadySent = await this.redis.get(idempotencyKey);
    if (alreadySent) {
      this.logger.warn(
        `Duplicate notification delivery detected for job ${job.id} (${job.data?.type ?? 'unknown'}); skipping send`,
      );
      return;
    }

    await this.notificationsService.sendEmail(job.data);

    await this.redis.set(
      idempotencyKey,
      '1',
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
    );
  }

  @OnQueueFailed()
  onFailed(job: Job<NotificationJobPayload>, error: Error): void {
    this.logger.error(
      `Notification job ${job.id} failed: ${error.message}`,
      error.stack,
    );
  }

  private getIdempotencyKey(job: Job<NotificationJobPayload>): string {
    return `notifications:idempotency:${job.id}`;
  }
}
