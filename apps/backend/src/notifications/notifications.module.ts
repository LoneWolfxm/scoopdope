import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Notification } from './notification.entity';
import { PushSubscription } from './push-subscription.entity';
import { PushNotificationQueue } from './push-notification-queue.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsEvents } from './notifications.events';
import { NotificationsGateway } from './notifications.gateway';
import { EmailModule } from '../email/email.module';
import { NotificationIdempotencyService } from './notification-idempotency.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, PushSubscription, User]),
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PushNotificationsService,
    NotificationsEvents,
    NotificationsGateway,
    NotificationIdempotencyService,
  ],
  exports: [NotificationsService, PushNotificationsService, NotificationIdempotencyService],
})
export class NotificationsModule {}
