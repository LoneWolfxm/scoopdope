import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentPerformance } from './student-performance.entity';
import { AbTestAssignment } from './ab-test-assignment.entity';
import { Enrollment } from '../enrollments/enrollment.entity';
import { AdaptiveLearningService } from './adaptive-learning.service';
import { AdaptiveLearningController } from './adaptive-learning.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StudentPerformance, AbTestAssignment, Enrollment]),
  ],
  providers: [AdaptiveLearningService],
  controllers: [AdaptiveLearningController],
  exports: [AdaptiveLearningService],
})
export class AdaptiveLearningModule {}