import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository, In, IsNull } from 'typeorm';
import { LearningPath } from './learning-path.entity';
import { LearningPathEnrollment } from './learning-path-enrollment.entity';
import { Course } from '../courses/course.entity';
import { CreateLearningPathDto, UpdateLearningPathDto } from './dto/learning-path.dto';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { CredentialsService } from '../credentials/credentials.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class LearningPathsService {
  private readonly logger = new Logger(LearningPathsService.name);

  constructor(
    @InjectRepository(LearningPath)
    private pathRepo: Repository<LearningPath>,
    @InjectRepository(LearningPathEnrollment)
    private enrollmentRepo: Repository<LearningPathEnrollment>,
    @InjectRepository(Course)
    private courseRepo: Repository<Course>,
    private enrollmentsService: EnrollmentsService,
    private credentialsService: CredentialsService,
    private usersService: UsersService,
    private eventEmitter: EventEmitter2,
  ) {}

  findAll(publishedOnly = true) {
    const where = publishedOnly ? { isPublished: true } : {};
    return this.pathRepo.find({ where, relations: ['courses'], order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const path = await this.pathRepo.findOne({ where: { id }, relations: ['courses'] });
    if (!path) throw new NotFoundException('Learning path not found');
    return path;
  }

  async create(dto: CreateLearningPathDto) {
    const courses = await this.courseRepo.findBy({ id: In(dto.courseIds) });
    if (courses.length !== dto.courseIds.length) {
      throw new BadRequestException('One or more courses not found');
    }
    const path = this.pathRepo.create({
      ...dto,
      courseOrder: dto.courseOrder ?? dto.courseIds,
      courses,
    });
    return this.pathRepo.save(path);
  }

  async update(id: string, dto: UpdateLearningPathDto) {
    const path = await this.findOne(id);
    if (dto.courseIds) {
      const courses = await this.courseRepo.findBy({ id: In(dto.courseIds) });
      if (courses.length !== dto.courseIds.length) {
        throw new BadRequestException('One or more courses not found');
      }
      path.courses = courses;
      if (!dto.courseOrder) path.courseOrder = dto.courseIds;
    }
    Object.assign(path, { ...dto, courseIds: undefined });
    return this.pathRepo.save(path);
  }

  async delete(id: string) {
    const path = await this.findOne(id);
    await this.pathRepo.remove(path);
  }

  async enroll(userId: string, learningPathId: string) {
    const path = await this.findOne(learningPathId);
    if (!path.isPublished) throw new BadRequestException('Learning path is not available');

    const existing = await this.enrollmentRepo.findOne({ where: { userId, learningPathId } });
    if (existing) throw new ConflictException('Already enrolled in this learning path');

    const enrollment = await this.enrollmentRepo.save(
      this.enrollmentRepo.create({ userId, learningPathId }),
    );

    // Enroll in all courses sequentially
    for (const course of path.courses) {
      try {
        await this.enrollmentsService.enroll(userId, course.id);
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
      }
    }

    return enrollment;
  }

  getEnrollments(userId: string) {
    return this.enrollmentRepo.find({
      where: { userId },
      relations: ['learningPath', 'learningPath.courses'],
    });
  }

  /** Called when a course is completed — checks if the full path is now done */
  async updateProgress(userId: string, courseId: string) {
    const enrollments = await this.enrollmentRepo.find({
      where: { userId, completedAt: IsNull() },
      relations: ['learningPath', 'learningPath.courses'],
    });
    const userEnrollments = enrollments.length
      ? await this.enrollmentsService.findByUser(userId)
      : [];
    let user: Awaited<ReturnType<UsersService['findById']>> | undefined;

    for (const enrollment of enrollments) {
      const inPath = enrollment.learningPath.courses.some((c) => c.id === courseId);
      if (!inPath) continue;

      const courseIds = enrollment.learningPath.courses.map((c) => c.id);
      const pathEnrollments = userEnrollments.filter((e) => courseIds.includes(e.courseId));
      const allCompleted =
        pathEnrollments.length === courseIds.length &&
        pathEnrollments.every((e) => e.completedAt !== null);

      if (allCompleted) {
        enrollment.completedAt = new Date();
        await this.enrollmentRepo.save(enrollment);

        user ??= await this.usersService.findById(userId);
        if (user?.stellarPublicKey) {
          await this.credentialsService.issueLearningPath(
            userId,
            enrollment.learningPathId,
            user.stellarPublicKey,
          );
        }

        // Emit path completion event so the notifications module can notify the learner.
        this.eventEmitter.emit('learningPath.completed', {
          userId,
          learningPathId: enrollment.learningPathId,
          learningPathTitle: enrollment.learningPath.title,
          completedAt: enrollment.completedAt,
        });
      }
    }
  }
}
