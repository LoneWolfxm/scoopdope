import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { StudySession } from './study-session.entity';
import { LessonTimeStat } from './lesson-time-stat.entity';
import { LessonTrackingService } from './lesson-tracking.service';
import { LessonTrackingController } from './lesson-tracking.controller';
import { Lesson } from '../courses/lesson.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([StudySession, LessonTimeStat, Lesson]),
    ScheduleModule.forRoot(),
  ],
  providers: [LessonTrackingService],
  controllers: [LessonTrackingController],
  exports: [LessonTrackingService],
})
export class LessonTrackingModule {}