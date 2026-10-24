import { Module, MiddlewareConsumer, NestModule, OnApplicationShutdown, Injectable } from '@nestjs/common';
import { TypeOrmModule, InjectDataSource } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { DataSource } from 'typeorm';

// ── Entities ────────────────────────────────────────────────────────────────────

import { User } from './users/user.entity';
import { Course } from './courses/course.entity';
import { Enrollment } from './enrollments/enrollment.entity';
import { Certificate } from './certificates/certificate.entity';
import { Bundle } from './bundles/bundle.entity';
import { BundleCourse } from './bundles/bundle-course.entity';
import { Payment } from './payments/payment.entity';
import { SupportTicketAttachment } from './support-tickets/support-ticket-attachment.entity';

// ── Modules ─────────────────────────────────────────────────────────────────────

import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CoursesModule } from './courses/courses.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { CertificatesModule } from './certificates/certificates.module';
import { ApiVersionModule } from './common/versioning';
import { PayoutsModule } from './payouts/payouts.module';
import { InstructorApplicationsModule } from './instructor-applications/instructor-applications.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { StreaksModule } from './streaks/streaks.module';
import { StudySessionsModule } from './study-sessions/study-sessions.module';
import { BundlesModule } from './bundles/bundles.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { LiveSessionsModule } from './live-sessions/live-sessions.module';
import { PaymentsModule } from './payments/payments.module';
import { RewardsModule } from './rewards/rewards.module';
import { SupportTicketsModule } from './support-tickets/support-tickets.module';
import { HealthModule } from './health/health.module';
import * as redisStore from 'cache-manager-redis-store';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';

import { RateLimitModule } from './rate-limit/rate-limit.module';
import { UserRateLimitGuard } from './rate-limit/user-rate-limit.guard';
import { AuthLoggerMiddleware } from './auth/auth-logger.middleware';
import { CsrfMiddleware } from './common/middleware/csrf.middleware';
import { EtagMiddleware } from './common/middleware/etag.middleware';

// Global request body size limit (1MB) applied to all routes.
const BODY_SIZE_LIMIT = '1mb';

// Bounded shutdown timeout so the process cannot hang indefinitely.
const SHUTDOWN_TIMEOUT_MS = 10_000;

@Injectable()
export class GracefulShutdownService implements OnApplicationShutdown {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    // Stop accepting new connections and let in-flight requests drain.
    // NestJS closes the HTTP server before invoking this hook; here we
    // release downstream resources (DB pool) with a bounded timeout.
    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, SHUTDOWN_TIMEOUT_MS),
    );

    const closeResources = (async () => {
      if (this.dataSource?.isInitialized) {
        await this.dataSource.destroy();
      }
    })();

    await Promise.race([closeResources, timeout]);
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    CacheModule.register({
      isGlobal: true,
      store: redisStore,
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
    }),
    TypeOrmModule.forRootAsync({
      useFactory: async (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('database.host'),
        port: configService.get('database.port'),
        username: configService.get('database.username'),
        password: configService.get('database.password'),
        database: configService.get('database.name'),
        entities: [
          User,
          Course,
          Enrollment,
          Certificate,
          Bundle,
          BundleCourse,
          Payment,
          SupportTicketAttachment,
        ],
        synchronize: configService.get('environment') !== 'production',
        logging: configService.get('environment') !== 'production',
      }),
      inject: [ConfigService],
    }),
    UsersModule,
    AuthModule,
    CoursesModule,
    EnrollmentsModule,
    CertificatesModule,
    PayoutsModule,
    InstructorApplicationsModule,
    HealthModule,
    MetricsModule,
    KycModule,
    RecommendationsModule,
    EmailModule,
    AnalyticsModule,
    WebhooksModule,
    ModerationModule,
    ImportExportModule,
    SearchModule,
    BatchModule,
    ApiUsageModule,
    QuizzesModule,
    CohortsModule,
    CdnModule,
    AccessControlModule,
    RateLimitModule,
    AuditModule,
    DownloadsModule,
    QaModule,
    AnnouncementsModule,
    AssignmentsModule,
    StreaksModule,
    StudySessionsModule,
    BundlesModule,
    SubscriptionsModule,
    LiveSessionsModule,
    PaymentsModule,
    RewardsModule,
    SupportTicketsModule,
    RateLimitModule,
    ApiVersionModule,
    MonitoringModule,
    ApiDocsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: UserRateLimitGuard,
    },
    GracefulShutdownService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        json({ limit: BODY_SIZE_LIMIT }),
        urlencoded({ limit: BODY_SIZE_LIMIT, extended: true }),
        AuthLoggerMiddleware,
        CsrfMiddleware,
        EtagMiddleware,
      )
      .forRoutes('*');
  }
}