import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Enrollment } from './entities/enrollment.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { ProcessedWebhookEvent } from './entities/processed-webhook-event.entity';

/** TTL for cached enrollment counts, in milliseconds. */
const ENROLLMENT_COUNT_TTL_MS = 60_000;

/** How long processed Stripe event IDs are retained before pruning. */
const PROCESSED_WEBHOOK_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CachedCount {
  value: number;
  expiresAt: number;
}

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  private readonly enrollmentCountCache = new Map<string, CachedCount>();

  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(ProcessedWebhookEvent)
    private readonly processedWebhookEventRepository: Repository<ProcessedWebhookEvent>,
  ) {}

  /**
   * Record a Stripe webhook event as processed.
   *
   * Returns `true` when this is the first delivery of the event (the caller
   * should process it), or `false` when the event ID was already recorded
   * (a duplicate delivery that must be skipped).
   */
  async tryMarkWebhookEventProcessed(eventId: string): Promise<boolean> {
    try {
      await this.processedWebhookEventRepository.insert({ eventId });
      return true;
    } catch (error) {
      // Unique-constraint violation => the event was already processed.
      if (this.isUniqueViolation(error)) {
        this.logger.warn(`Duplicate Stripe webhook event skipped: ${eventId}`);
        return false;
      }
      throw error;
    }
  }

  /**
   * Handle a Stripe webhook event idempotently.
   *
   * Returns `true` when the event was processed, `false` when it was a
   * duplicate delivery (caller should still respond with 200).
   */
  async handleStripeWebhookEvent(
    eventId: string,
    handler: () => Promise<void>,
  ): Promise<boolean> {
    const isFirstDelivery = await this.tryMarkWebhookEventProcessed(eventId);
    if (!isFirstDelivery) {
      return false;
    }
    await handler();
    return true;
  }

  /**
   * Prune processed webhook event IDs older than the retention window (30 days).
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupProcessedWebhookEvents(): Promise<number> {
    const cutoff = new Date(Date.now() - PROCESSED_WEBHOOK_EVENT_TTL_MS);
    const result = await this.processedWebhookEventRepository
      .createQueryBuilder()
      .delete()
      .from(ProcessedWebhookEvent)
      .where('processed_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  private isUniqueViolation(error: unknown): boolean {
    const code = (error as { code?: string; driverError?: { code?: string } })?.code
      ?? (error as { driverError?: { code?: string } })?.driverError?.code;
    return code === '23505' || code === 'SQLITE_CONSTRAINT' || code === 'ER_DUP_ENTRY';
  }

  async enroll(userId: string, courseId: string, adminOverride = false): Promise<Enrollment> {
    // Throws NotFoundException (404) when the course doesn't exist (or is soft-deleted).
    const course = await this.coursesService.findOne(courseId);

    if (course.status !== CourseStatus.PUBLISHED && !adminOverride) {
      throw new ForbiddenException('Course is not open for enrollment');
    }

    const existing = await this.repo.findOne({ where: { userId, courseId } });
    if (existing) throw new ConflictException('Already enrolled in this course');

    // Enforce prerequisite courses before allowing enrollment. Instructors
    // configure prerequisites via the course prerequisites API; students must
    // have completed every prerequisite course first.
    await this.prereqService.enforcePrerequisites(userId, courseId, adminOverride);

    // Pin the student to the latest published version at enrollment time
    const versions = await this.versioningService.listVersions(courseId);
    const latestVersion = versions[0] ?? null;

    const enrollment = await this.repo.save(
      this.repo.create({
        userId,
        courseId,
        enrolledVersionNumber: latestVersion?.versionNumber ?? null,
        transactionHash: null,
      }),
    );

  async findByCourse(courseId: string): Promise<Enrollment[]> {
    return this.enrollmentRepository.find({ where: { courseId } });
  }

  async notifyAllEnrolled(courseId: string, message: string): Promise<void> {
    const enrollments = await this.enrollmentRepository.find({
      where: { courseId },
      select: ['studentId'],
    });

    if (enrollments.length === 0) {
      return;
    }

    // Invalidate the cached count so the new enrollment is reflected immediately.
    this.enrollmentCountCache.delete(courseId);

    // Emit legacy event consumed by notifications / other listeners.
    this.eventEmitter.emit('enrollment.created', {
      enrollmentId: enrollment.id,
      userId,
      courseId,
      enrolledAt: enrollment.enrolledAt,
    });

    // Emit the richer on-chain confirmed event for analytics and downstream modules.
    this.eventEmitter.emit(
      'enrollment.confirmed',
      new EnrollmentConfirmedEvent({
        enrollmentId: enrollment.id,
        userId,
        courseId,
        transactionHash,
        enrolledAt: enrollment.enrolledAt,
      }),
    );

    this.metrics.incrementEnrollment(courseId, 'all');

    return enrollment;
  }

  /**
   * Count total enrollments for a course.
   *
   * Results are cached for a short TTL so repeated calls within the window
   * do not hit the database.
   */
  async countByCoursId(courseId: string): Promise<number> {
    const cached = this.enrollmentCountCache.get(courseId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.repo.count({ where: { courseId } });
    this.enrollmentCountCache.set(courseId, {
      value,
      expiresAt: Date.now() + ENROLLMENT_COUNT_TTL_MS,
    });
    return value;
  }

  /**
   * Count completed enrollments for a course
   */
  async countCompletedByCourseId(courseId: string): Promise<number> {
    return this.repo
      .createQueryBuilder('enrollment')
      .where('enrollment.courseId = :courseId', { courseId })
      .andWhere('enrollment.completedAt IS NOT NULL')
      .getCount();
  }

  async unenroll(userId: string, courseId: string): Promise<void> {
    const enrollment = await this.repo.findOne({ where: { userId, courseId } });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    await this.repo.remove(enrollment);

    // Invalidate the cached count so the removal is reflected immediately.
    this.enrollmentCountCache.delete(courseId);

    // Notify waitlist system that a spot has opened
    this.eventEmitter.emit('enrollment.removed', { userId, courseId });
  }

  findByUser(userId: string): Promise<Enrollment[]> {
    return this.repo.find({
      where: { userId },
      relations: ['course'],
      order: { enrolledAt: 'DESC' },
    });
  }

  async remove(id: string): Promise<void> {
    const enrollment = await this.enrollmentRepository.findOne({ where: { id } });
    if (!enrollment) {
      throw new NotFoundException(`Enrollment ${id} not found`);
    }
    await this.enrollmentRepository.remove(enrollment);
  }
}
