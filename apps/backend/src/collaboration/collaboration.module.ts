import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PresenceService } from './presence.service';
import { CollaborationGateway } from './collaboration.gateway';
import { CollaborationCleanupService } from './collaboration-cleanup.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  providers: [PresenceService, CollaborationGateway, CollaborationCleanupService],
  exports: [PresenceService, CollaborationGateway],
})
export class CollaborationModule {}