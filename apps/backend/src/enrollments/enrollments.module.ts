import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { Enrollment } from './enrollment.entity';
import { EnrollmentsService } from './enrollments.service';
import { EnrollmentsController } from './enrollments.controller';
import { CoursesModule } from '../courses/courses.module';
import { CourseVersion } from '../courses/course-version.entity';
import { CourseVersioningService } from '../courses/course-versioning.service';
import { Course } from '../courses/course.entity';
import { MetricsModule } from '../metrics/metrics.module';
import { StellarModule } from '../stellar/stellar.module';
import { ProcessedWebhookEvent } from './processed-webhook-event.entity';
import { ProcessedWebhookEventsService } from './processed-webhook-events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Enrollment,
      CourseVersion,
      Course,
      ProcessedWebhookEvent,
    ]),
    CacheModule.register({ ttl: 60_000 }),
    ScheduleModule.forRoot(),
    CoursesModule,
    MetricsModule,
    StellarModule,
  ],
  providers: [
    EnrollmentsService,
    CourseVersioningService,
    ProcessedWebhookEventsService,
  ],
  controllers: [EnrollmentsController],
  exports: [EnrollmentsService, ProcessedWebhookEventsService],
})
export class EnrollmentsModule {}