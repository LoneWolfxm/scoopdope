import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { StudentPerformance } from './student-performance.entity';
import { AbTestAssignment } from './ab-test-assignment.entity';
import { Enrollment } from '../enrollments/enrollment.entity';

const MASTERY_THRESHOLD_UP = 0.8;
const MASTERY_THRESHOLD_DOWN = 0.4;

@Injectable()
export class AdaptiveLearningService {
  constructor(
    @InjectRepository(StudentPerformance)
    private performanceRepo: Repository<StudentPerformance>,
    @InjectRepository(AbTestAssignment)
    private abTestRepo: Repository<AbTestAssignment>,
    @Optional()
    @InjectRepository(Enrollment)
    private enrollmentRepo?: Repository<Enrollment>,
  ) {}

  async recordQuizResult(
    userId: string,
    topicId: string,
    score: number, // 0-100
  ): Promise<StudentPerformance> {
    let perf = await this.performanceRepo.findOne({ where: { userId, topicId } });

    if (!perf) {
      perf = this.performanceRepo.create({ userId, topicId });
    }

    // Rolling average
    const total = perf.averageScore * perf.attemptCount + score;
    perf.attemptCount += 1;
    perf.averageScore = total / perf.attemptCount;
    perf.masteryLevel = perf.averageScore / 100;

    // Adjust difficulty
    perf.currentDifficulty = this.adjustDifficulty(perf.masteryLevel, perf.currentDifficulty);

    return this.performanceRepo.save(perf);
  }

  private adjustDifficulty(
    mastery: number,
    current: 'easy' | 'medium' | 'hard',
  ): 'easy' | 'medium' | 'hard' {
    if (mastery >= MASTERY_THRESHOLD_UP) {
      if (current === 'easy') return 'medium';
      if (current === 'medium') return 'hard';
    }
    if (mastery < MASTERY_THRESHOLD_DOWN) {
      if (current === 'hard') return 'medium';
      if (current === 'medium') return 'easy';
    }
    return current;
  }

  async getRecommendations(
    userId: string,
    options: { includeCompleted?: boolean } = {},
  ): Promise<{
    weakTopics: string[];
    recommendedDifficulty: Record<string, string>;
  }> {
    const performances = await this.performanceRepo.find({ where: { userId } });

    // Exclude courses the learner is currently enrolled in or has completed.
    // Completed courses are only restored when includeCompleted is true
    // (refresher recommendations).
    const excludedStatuses = options.includeCompleted
      ? ['ACTIVE']
      : ['ACTIVE', 'COMPLETED'];

    let excludedCourseIds: Set<string> = new Set();
    if (this.enrollmentRepo) {
      const enrollments = await this.enrollmentRepo.find({
        where: { userId, status: In(excludedStatuses) },
      });
      excludedCourseIds = new Set(enrollments.map((e) => e.courseId));
    }

    const weakTopics = performances
      .filter((p) => p.masteryLevel < MASTERY_THRESHOLD_DOWN)
      .map((p) => p.topicId)
      .filter((topicId) => !excludedCourseIds.has(topicId));

    const recommendedDifficulty: Record<string, string> = {};
    for (const p of performances) {
      if (excludedCourseIds.has(p.topicId)) continue;
      recommendedDifficulty[p.topicId] = p.currentDifficulty;
    }

    return { weakTopics, recommendedDifficulty };
  }

  async getPerformance(userId: string, topicId?: string): Promise<StudentPerformance[]> {
    const where = topicId ? { userId, topicId } : { userId };
    return this.performanceRepo.find({ where });
  }

  /** Assign user to A/B experiment variant deterministically */
  async getOrAssignVariant(
    userId: string,
    experimentName: string,
  ): Promise<'control' | 'variant'> {
    const existing = await this.abTestRepo.findOne({
      where: { userId, experimentName },
    });
    if (existing) return existing.variant;

    // Simple deterministic split based on userId hash
    const hash = userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const variant: 'control' | 'variant' = hash % 2 === 0 ? 'control' : 'variant';

    await this.abTestRepo.save(
      this.abTestRepo.create({ userId, experimentName, variant }),
    );
    return variant;
  }

  async recordAbOutcome(
    userId: string,
    experimentName: string,
    outcomeScore: number,
  ): Promise<void> {
    await this.abTestRepo.update({ userId, experimentName }, { outcomeScore });
  }

  async getAbTestResults(experimentName: string): Promise<{
    control: { count: number; avgScore: number };
    variant: { count: number; avgScore: number };
  }> {
    const assignments = await this.abTestRepo.find({ where: { experimentName } });

    const summarize = (v: 'control' | 'variant') => {
      const group = assignments.filter((a) => a.variant === v && a.outcomeScore != null);
      const count = group.length;
      const avgScore = count > 0 ? group.reduce((s, a) => s + a.outcomeScore, 0) / count : 0;
      return { count, avgScore };
    };

    return { control: summarize('control'), variant: summarize('variant') };
  }
}
