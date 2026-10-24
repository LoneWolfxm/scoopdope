import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { Repository, LessThanOrEqual, GreaterThanOrEqual } from 'typeorm';
import { StudySession } from './study-session.entity';
import { LessonTimeStat } from './lesson-time-stat.entity';
import { LessonProgress } from './lesson-progress.entity';
import { Lesson } from '../courses/lesson.entity';

export interface LessonProgressUpdate {
  watchedSeconds?: number;
  furthestTimestamp?: number;
  currentTimestamp?: number;
  completed?: boolean;
}

export interface LessonProgressResponse {
  lessonId: string;
  userId: string;
  watchedSeconds: number;
  furthestTimestamp: number;
  completed: boolean;
  updatedAt: Date;
}

@Injectable()
export class LessonTrackingService {
  private readonly logger = new Logger(LessonTrackingService.name);
  private readonly MAX_SESSION_DURATION_MINUTES = 120; // 2 hours max before auto-closing
  private readonly HEARTBEAT_TIMEOUT_SECONDS = 90; // End session if no heartbeat within 90s

  constructor(
    @InjectRepository(StudySession) private sessionRepo: Repository<StudySession>,
    @InjectRepository(LessonTimeStat) private statsRepo: Repository<LessonTimeStat>,
    @InjectRepository(LessonProgress) private progressRepo: Repository<LessonProgress>,
    @InjectRepository(Lesson) private lessonRepo: Repository<Lesson>,
  ) {}

  /**
   * Start a study session for a student on a lesson
   */
  async startSession(
    userId: string,
    lessonId: string,
    courseId: string,
  ): Promise<StudySession> {
    // Close any active session for this user on a different lesson
    await this.sessionRepo.update(
      { userId, isActive: true, lessonId: (q) => q.where('lessonId != :lessonId', { lessonId }) },
      { isActive: false },
    );

    const now = new Date();
    const session = this.sessionRepo.create({
      userId,
      lessonId,
      courseId,
      startedAt: now,
      lastHeartbeatAt: now,
      isActive: true,
      durationSeconds: 0,
    });

    return this.sessionRepo.save(session);
  }

  /**
   * End a study session and calculate duration
   */
  async endSession(sessionId: string): Promise<StudySession> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const endedAt = new Date();
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000),
    );

    // Cap at max session duration (prevent outliers)
    const cappedDuration = Math.min(durationSeconds, this.MAX_SESSION_DURATION_MINUTES * 60);

    session.endedAt = endedAt;
    session.durationSeconds = cappedDuration;
    session.isActive = false;

    const saved = await this.sessionRepo.save(session);

    // Update aggregated stats
    await this.updateLessonStats(session.lessonId, session.courseId);

    return saved;
  }

  /**
   * Heartbeat to keep session alive (reset idle timeout)
   */
  async heartbeat(sessionId: string): Promise<StudySession> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const now = new Date();
    session.updatedAt = now;
    session.lastHeartbeatAt = now;
    return this.sessionRepo.save(session);
  }

  /**
   * Record a lesson progress update, persisting watchedSeconds and furthestTimestamp.
   *
   * watchedSeconds is computed from the delta between the previous furthestTimestamp
   * and the new one, so rewatched segments are not double-counted. A rewind (new
   * timestamp below the previous furthest point) contributes no additional watch time.
   */
  async updateLessonProgress(
    userId: string,
    lessonId: string,
    courseId: string,
    update: LessonProgressUpdate,
  ): Promise<LessonProgressResponse> {
    let progress = await this.progressRepo.findOne({ where: { userId, lessonId } });
    if (!progress) {
      progress = this.progressRepo.create({
        userId,
        lessonId,
        courseId,
        watchedSeconds: 0,
        furthestTimestamp: 0,
        completed: false,
      });
    }

    const previousFurthest = progress.furthestTimestamp ?? 0;
    const incomingTimestamp =
      update.furthestTimestamp ?? update.currentTimestamp ?? previousFurthest;

    // Only advance the furthest point; rewinds never reduce it.
    const newFurthest = Math.max(previousFurthest, incomingTimestamp);

    // Watch time is the forward delta only, excluding rewatched segments.
    const delta = Math.max(0, newFurthest - previousFurthest);
    const computedWatched = (progress.watchedSeconds ?? 0) + delta;

    // If the client supplies an explicit watchedSeconds, take the larger of the
    // two so we never under-count but also never double-count rewatches.
    const explicitWatched =
      typeof update.watchedSeconds === 'number' && update.watchedSeconds >= 0
        ? update.watchedSeconds
        : 0;

    progress.watchedSeconds = Math.max(computedWatched, explicitWatched);
    progress.furthestTimestamp = newFurthest;
    if (typeof update.completed === 'boolean') {
      progress.completed = update.completed;
    }
    progress.updatedAt = new Date();

    const saved = await this.progressRepo.save(progress);

    return this.toProgressResponse(saved);
  }

  /**
   * Get the persisted lesson progress for a student, including furthestTimestamp
   * so the frontend can resume playback from where the learner left off.
   */
  async getLessonProgress(
    userId: string,
    lessonId: string,
  ): Promise<LessonProgressResponse | null> {
    const progress = await this.progressRepo.findOne({ where: { userId, lessonId } });
    if (!progress) {
      return null;
    }
    return this.toProgressResponse(progress);
  }

  private toProgressResponse(progress: LessonProgress): LessonProgressResponse {
    return {
      lessonId: progress.lessonId,
      userId: progress.userId,
      watchedSeconds: progress.watchedSeconds ?? 0,
      furthestTimestamp: progress.furthestTimestamp ?? 0,
      completed: progress.completed ?? false,
      updatedAt: progress.updatedAt,
    };
  }

  /**
   * Get total time spent by a student on a specific lesson
   */
  async getTotalTimeForLesson(userId: string, lessonId: string): Promise<number> {
    const result = await this.sessionRepo
      .createQueryBuilder('s')
      .select('SUM(s.durationSeconds)', 'totalSeconds')
      .where('s.userId = :userId', { userId })
      .andWhere('s.lessonId = :lessonId', { lessonId })
      .andWhere('s.isActive = :isActive', { isActive: false })
      .getRawOne<{ totalSeconds: string | null }>();

    return result?.totalSeconds ? parseInt(result.totalSeconds, 10) : 0;
  }

  /**
   * Get total time spent by a student on all lessons in a course
   */
  async getTotalTimeForCourse(userId: string, courseId: string): Promise<number> {
    const result = await this.sessionRepo
      .createQueryBuilder('s')
      .select('SUM(s.durationSeconds)', 'totalSeconds')
      .where('s.userId = :userId', { userId })
      .andWhere('s.courseId = :courseId', { courseId })
      .andWhere('s.isActive = :isActive', { isActive: false })
      .getRawOne<{ totalSeconds: string | null }>();

    return result?.totalSeconds ? parseInt(result.totalSeconds, 10) : 0;
  }

  /**
   * Update lesson statistics (average, max, min, student count, difficulty flag)
   */
  async updateLessonStats(lessonId: string, courseId: string): Promise<LessonTimeStat> {
    const lesson = await this.lessonRepo.findOne({ where: { id: lessonId } });
    if (!lesson) {
      throw new Error(`Lesson ${lessonId} not found`);
    }

    // Get all completed sessions for this lesson
    const sessions = await this.sessionRepo.find({
      where: { lessonId, isActive: false },
    });

    if (sessions.length === 0) {
      // No data yet - create or update stats with zeros
      let stats = await this.statsRepo.findOne({ where: { lessonId } });
      if (!stats) {
        stats = this.statsRepo.create({
          lessonId,
          courseId,
          totalTimeSeconds: 0,
          averageTimeSeconds: 0,
          maxTimeSeconds: 0,
          minTimeSeconds: 0,
          studentCount: 0,
          isDifficult: false,
        });
      }
      return this.statsRepo.save(stats);
    }

    // Calculate stats
    const durations = sessions.map((s) => s.durationSeconds).filter((d) => d > 0);
    const totalTime = durations.reduce((sum, d) => sum + d, 0);
    const uniqueStudents = new Set(sessions.map((s) => s.userId)).size;
    const avgTime = uniqueStudents > 0 ? Math.floor(totalTime / uniqueStudents) : 0;
    const maxTime = Math.max(...durations, 0);
    const minTime = Math.min(...durations, 0);

    // Determine if difficult: if average > 90th percentile of course lessons
    const courseLessons = await this.statsRepo.find({ where: { courseId } });
    const allAverages = courseLessons
      .map((l) => l.averageTimeSeconds)
      .filter((a) => a > 0)
      .sort((a, b) => a - b);

    let isDifficult = false;
    if (allAverages.length > 0) {
      const p90 = allAverages[Math.floor(allAverages.length * 0.9)];
      isDifficult = avgTime > p90;
    }

    let stats = await this.statsRepo.findOne({ where: { lessonId } });
    if (!stats) {
      stats = this.statsRepo.create({ lessonId, courseId });
    }

    stats.totalTimeSeconds = totalTime;
    stats.averageTimeSeconds = avgTime;
    stats.maxTimeSeconds = maxTime;
    stats.minTimeSeconds = minTime > 0 ? minTime : avgTime;
    stats.studentCount = uniqueStudents;
    stats.isDifficult = isDifficult;

    return this.statsRepo.save(stats);
  }

  /**
   * Get lesson statistics for a single lesson
   */
  async getLessonStats(lessonId: string): Promise<LessonTimeStat | null> {
    return this.statsRepo.findOne({ where: { lessonId }, relations: ['lesson', 'course'] });
  }

  /**
   * Get all lesson statistics for a course, optionally filtered by difficulty
   */
  async getCourseLessonStats(courseId: string, difficultOnly = false): Promise<LessonTimeStat[]> {
    const query = this.statsRepo
      .createQueryBuilder('ls')
      .where('ls.courseId = :courseId', { courseId })
      .orderBy('ls.averageTimeSeconds', 'DESC');

    if (difficultOnly) {
      query.andWhere('ls.isDifficult = :isDifficult', { isDifficult: true });
    }

    return query.getMany();
  }

  /**
   * Get difficulty report for instructor: lessons flagged as difficult
   */
  async getDifficultyReport(courseId: string): Promise<{
    courseId: string;
    difficultLessons: Array<{
      lessonId: string;
      title: string;
      averageTimeSeconds: number;
      studentCount: number;
      maxTimeSeconds: number;
    }>;
    overallMedianTimeSeconds: number;
    recommendedThreshold: number;
  }> {
    const stats = await this.getCourseLessonStats(courseId);

    const averages = stats.map((s) => s.averageTimeSeconds).filter((a) => a > 0);
    const median =
      averages.length > 0
        ? averages.sort((a, b) => a - b)[Math.floor(averages.length / 2)]
        : 0;

    const difficultLessons = await this.statsRepo
      .createQueryBuilder('ls')
      .leftJoinAndSelect('ls.lesson', 'lesson')
      .where('ls.courseId = :courseId', { courseId })
      .andWhere('ls.isDifficult = :isDifficult', { isDifficult: true })
      .orderBy('ls.averageTimeSeconds', 'DESC')
      .getMany();

    return {
      courseId,
      difficultLessons: difficultLessons.map((ls) => ({
        lessonId: ls.lessonId,
        title: ls.lesson?.title || 'Unknown',
        averageTimeSeconds: ls.averageTimeSeconds,
        studentCount: ls.studentCount,
        maxTimeSeconds: ls.maxTimeSeconds,
      })),
      overallMedianTimeSeconds: median,
      recommendedThreshold: Math.round(median * 1.5),
    };
  }

  /**
   * Scheduled job: end active sessions whose last heartbeat is older than
   * HEARTBEAT_TIMEOUT_SECONDS (e.g. tab closed or device asleep).
   */
  @Interval('heartbeat-timeout-check', 30_000)
  async handleHeartbeatTimeout(): Promise<void> {
    try {
      const closed = await this.autoCloseStaleHeartbeatSessions();
      if (closed > 0) {
        this.logger.log(`Auto-ended ${closed} session(s) due to missing heartbeat`);
      }
    } catch (err) {
      this.logger.error('Failed to auto-end stale heartbeat sessions', err as Error);
    }
  }

  /**
   * End active sessions whose lastHeartbeatAt is older than the heartbeat timeout.
   * Returns the number of sessions ended.
   */
  async autoCloseStaleHeartbeatSessions(): Promise<number> {
    const cutoffTime = new Date(
      Date.now() - this.HEARTBEAT_TIMEOUT_SECONDS * 1000,
    );

    const staleSessions = await this.sessionRepo.find({
      where: {
        isActive: true,
        lastHeartbeatAt: LessThanOrEqual(cutoffTime),
      },
    });

    for (const session of staleSessions) {
      await this.endSession(session.id);
    }

    return staleSessions.length;
  }

  /**
   * Auto-close sessions that haven't had a heartbeat in MAX_SESSION_DURATION_MINUTES
   */
  async autoCloseIdleSessions(): Promise<number> {
    const cutoffTime = new Date(
      Date.now() - this.MAX_SESSION_DURATION_MINUTES * 60 * 1000,
    );

    const idleSessions = await this.sessionRepo.find({
      where: {
        isActive: true,
        updatedAt: LessThanOrEqual(cutoffTime),
      },
    });

    for (const session of idleSessions) {
      await this.endSession(session.id);
    }

    return idleSessions.length;
  }
}
