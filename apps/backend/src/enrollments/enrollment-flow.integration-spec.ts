import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service';
import { Enrollment } from './enrollment.entity';
import { ProgressService } from '../progress/progress.service';
import { Progress } from '../progress/progress.entity';
import { CredentialsService } from '../credentials/credentials.service';
import { Credential } from '../credentials/credential.entity';
import { Course, CourseStatus } from '../courses/course.entity';
import { CourseModule as CourseModuleEntity } from '../courses/course-module.entity';
import { CoursesService } from '../courses/courses.service';
import { PrerequisitesService } from '../courses/prerequisites.service';
import { CourseVersioningService } from '../courses/course-versioning.service';
import { MetricsService } from '../metrics/metrics.service';
import { StellarService } from '../stellar/stellar.service';
import { KycService } from '../kyc/kyc.service';
import { UsersService } from '../users/users.service';
import { StreaksService } from '../streaks/streaks.service';
import { BundlesService } from '../bundles/bundles.service';

/** Minimal in-memory repository so the services interact through shared state. */
type Where = Record<string, unknown>;

function inMemoryRepo<T extends object>() {
  const rows: T[] = [];
  let seq = 0;
  const field = (row: T, k: string) => (row as Record<string, unknown>)[k];
  // Primitive values must match exactly; FindOperators (e.g. Not(IsNull())) match any set value.
  const matches = (row: T, where: Where = {}) =>
    Object.entries(where).every(([k, v]) =>
      v !== null && typeof v === 'object' ? field(row, k) != null : field(row, k) === v
    );
  return {
    rows,
    create: (data: Partial<T>) => ({ ...data }) as T,
    save: async (entity: T) => {
      if (!field(entity, 'id'))
        Object.assign(entity, { id: `id-${++seq}`, enrolledAt: new Date() });
      Object.assign(entity, { updatedAt: new Date() });
      if (!rows.includes(entity)) rows.push(entity);
      return entity;
    },
    findOne: async ({ where }: { where?: Where }) => rows.find((r) => matches(r, where)) ?? null,
    find: async ({ where }: { where?: Where } = {}) => rows.filter((r) => matches(r, where)),
    count: async ({ where }: { where?: Where } = {}) =>
      rows.filter((r) => matches(r, where)).length,
    remove: async (entity: T) => {
      rows.splice(rows.indexOf(entity), 1);
      return entity;
    },
  };
}

describe('Enrollment flow (integration)', () => {
  const userId = 'user-1';
  const courseId = 'course-1';
  const stellarKey = 'GSTUDENTKEY';

  let enrollments: EnrollmentsService;
  let progress: ProgressService;
  let enrollmentRepo: ReturnType<typeof inMemoryRepo<Enrollment>>;
  let progressRepo: ReturnType<typeof inMemoryRepo<Progress>>;
  let credentialRepo: ReturnType<typeof inMemoryRepo<Credential>>;
  let eventEmitter: { emit: jest.Mock };
  let prerequisites: { enforcePrerequisites: jest.Mock };

  const stellar = {
    recordEnrollment: jest.fn().mockResolvedValue('tx-enroll'),
    recordProgress: jest.fn().mockResolvedValue('tx-progress'),
    issueCredential: jest.fn().mockResolvedValue('tx-credential'),
    mintReward: jest.fn().mockResolvedValue('tx-reward'),
  };

  beforeEach(async () => {
    enrollmentRepo = inMemoryRepo<Enrollment>();
    progressRepo = inMemoryRepo<Progress>();
    credentialRepo = inMemoryRepo<Credential>();
    eventEmitter = { emit: jest.fn() };
    prerequisites = { enforcePrerequisites: jest.fn().mockResolvedValue(undefined) };

    const course = {
      id: courseId,
      title: 'Intro to Stellar',
      status: CourseStatus.PUBLISHED,
      requiresKyc: false,
      skills: ['stellar'],
    };

    const module = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        ProgressService,
        CredentialsService,
        { provide: getRepositoryToken(Enrollment), useValue: enrollmentRepo },
        { provide: getRepositoryToken(Progress), useValue: progressRepo },
        { provide: getRepositoryToken(Credential), useValue: credentialRepo },
        { provide: getRepositoryToken(Course), useValue: inMemoryRepo() },
        { provide: getRepositoryToken(CourseModuleEntity), useValue: inMemoryRepo() },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: StellarService, useValue: stellar },
        { provide: CoursesService, useValue: { findOne: jest.fn().mockResolvedValue(course) } },
        { provide: PrerequisitesService, useValue: prerequisites },
        {
          provide: CourseVersioningService,
          useValue: { listVersions: jest.fn().mockResolvedValue([{ versionNumber: 1 }]) },
        },
        {
          provide: MetricsService,
          useValue: { incrementEnrollment: jest.fn(), incrementCourseCompleted: jest.fn() },
        },
        { provide: KycService, useValue: { isApproved: jest.fn().mockResolvedValue(true) } },
        {
          provide: UsersService,
          useValue: { findById: jest.fn().mockResolvedValue({ id: userId }) },
        },
        { provide: StreaksService, useValue: { recordActivity: jest.fn() } },
        { provide: BundlesService, useValue: { updateProgress: jest.fn() } },
      ],
    }).compile();

    enrollments = module.get(EnrollmentsService);
    progress = module.get(ProgressService);
  });

  afterEach(() => jest.clearAllMocks());

  it('enrolls, completes lessons and earns a credential', async () => {
    // 1. Enroll
    const enrollment = await enrollments.enroll(userId, courseId);
    expect(enrollment).toMatchObject({
      userId,
      courseId,
      enrolledVersionNumber: 1,
      transactionHash: 'tx-enroll',
    });
    expect(enrollmentRepo.rows).toHaveLength(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'enrollment.created',
      expect.objectContaining({ userId, courseId })
    );

    // 2. Complete a lesson (partial progress) — no credential yet
    await progress.record(userId, { courseId, lessonId: 'lesson-1', progressPct: 50 }, stellarKey);
    expect(progressRepo.rows[0]).toMatchObject({ progressPct: 50, txHash: 'tx-progress' });
    expect(progressRepo.rows[0].completedAt).toBeUndefined();
    expect(credentialRepo.rows).toHaveLength(0);

    // 3. Complete the final lesson — credential is issued
    await progress.record(userId, { courseId, lessonId: 'lesson-2', progressPct: 100 }, stellarKey);
    expect(progressRepo.rows).toHaveLength(1);
    expect(progressRepo.rows[0].completedAt).toBeInstanceOf(Date);
    expect(credentialRepo.rows).toHaveLength(1);
    expect(credentialRepo.rows[0]).toMatchObject({
      userId,
      courseId,
      txHash: 'tx-credential',
      stellarPublicKey: stellarKey,
    });
    expect(stellar.issueCredential).toHaveBeenCalledWith(
      stellarKey,
      courseId,
      expect.objectContaining({ courseName: 'Intro to Stellar' })
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'course.completed',
      expect.objectContaining({ userId, courseId })
    );
  });

  it('rejects a duplicate enrollment', async () => {
    await enrollments.enroll(userId, courseId);
    await expect(enrollments.enroll(userId, courseId)).rejects.toThrow(ConflictException);
    expect(enrollmentRepo.rows).toHaveLength(1);
  });

  it('does not issue a second credential when completion is recorded twice', async () => {
    await enrollments.enroll(userId, courseId);
    await progress.record(userId, { courseId, progressPct: 100 }, stellarKey);
    await progress.record(userId, { courseId, progressPct: 100 }, stellarKey);
    expect(credentialRepo.rows).toHaveLength(1);
    expect(stellar.issueCredential).toHaveBeenCalledTimes(1);
  });

  describe('learning path prerequisites', () => {
    const missingPrerequisites = [
      { courseId: 'course-prereq-1', title: 'Stellar Basics' },
      { courseId: 'course-prereq-2', title: 'Keys and Accounts' },
    ];

    const rejectWithMissingPrerequisites = () =>
      prerequisites.enforcePrerequisites.mockRejectedValueOnce(
        new UnprocessableEntityException({ missingPrerequisites })
      );

    it('returns 422 with the missing prerequisites when they are not completed', async () => {
      rejectWithMissingPrerequisites();

      const error = await enrollments.enroll(userId, courseId).catch((e) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getStatus()).toBe(422);
      expect(error.getResponse()).toMatchObject({ missingPrerequisites });
      expect(prerequisites.enforcePrerequisites).toHaveBeenCalledWith(userId, courseId, {
        override: false,
      });
      expect(enrollmentRepo.rows).toHaveLength(0);
      expect(stellar.recordEnrollment).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'enrollment.created',
        expect.anything()
      );
    });

    it('allows enrollment once prerequisites are completed', async () => {
      // Prerequisites satisfied: the check resolves without throwing.
      const enrollment = await enrollments.enroll(userId, courseId);

      expect(enrollment).toMatchObject({ userId, courseId });
      expect(prerequisites.enforcePrerequisites).toHaveBeenCalledWith(userId, courseId, {
        override: false,
      });
      expect(enrollmentRepo.rows).toHaveLength(1);
    });

    it('lets an admin bypass the prerequisite check with override=true', async () => {
      // Even if the check would fail, the override must skip enforcement.
      prerequisites.enforcePrerequisites.mockImplementationOnce(
        async (_userId: string, _courseId: string, options?: { override?: boolean }) => {
          if (!options?.override) {
            throw new UnprocessableEntityException({ missingPrerequisites });
          }
        }
      );

      const enrollment = await enrollments.enroll(userId, courseId, { override: true });

      expect(enrollment).toMatchObject({ userId, courseId });
      expect(prerequisites.enforcePrerequisites).toHaveBeenCalledWith(userId, courseId, {
        override: true,
      });
      expect(enrollmentRepo.rows).toHaveLength(1);
    });
  });
});
