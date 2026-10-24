import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoursePrerequisite } from './course-prerequisite.entity';
import { Enrollment } from '../enrollments/enrollment.entity';
import { Course } from './course.entity';

@Injectable()
export class PrerequisitesService {
  constructor(
    @InjectRepository(CoursePrerequisite)
    private prereqRepo: Repository<CoursePrerequisite>,
    @InjectRepository(Enrollment)
    private enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Course)
    private courseRepo: Repository<Course>,
  ) {}

  async addPrerequisite(courseId: string, prerequisiteId: string): Promise<CoursePrerequisite> {
    if (courseId === prerequisiteId) {
      throw new BadRequestException('A course cannot be its own prerequisite');
    }
    const [course, prereq] = await Promise.all([
      this.courseRepo.findOne({ where: { id: courseId, isDeleted: false } }),
      this.courseRepo.findOne({ where: { id: prerequisiteId, isDeleted: false } }),
    ]);
    if (!course) throw new NotFoundException('Course not found');
    if (!prereq) throw new NotFoundException('Prerequisite course not found');

    return this.prereqRepo.save(this.prereqRepo.create({ courseId, prerequisiteId }));
  }

  async removePrerequisite(courseId: string, prerequisiteId: string): Promise<void> {
    const record = await this.prereqRepo.findOne({ where: { courseId, prerequisiteId } });
    if (!record) throw new NotFoundException('Prerequisite relationship not found');
    await this.prereqRepo.remove(record);
  }

  async getPrerequisites(courseId: string): Promise<CoursePrerequisite[]> {
    return this.prereqRepo.find({
      where: { courseId },
      relations: ['prerequisite'],
    });
  }

  /** Returns the full prerequisite chain (BFS) for visualization */
  async getPrerequisiteChain(courseId: string): Promise<Record<string, string[]>> {
    const chain: Record<string, string[]> = {};
    const queue = [courseId];
    const visited = new Set<string>();

    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const prereqs = await this.prereqRepo.find({ where: { courseId: current } });
      chain[current] = prereqs.map((p) => p.prerequisiteId);
      for (const p of prereqs) {
        if (!visited.has(p.prerequisiteId)) queue.push(p.prerequisiteId);
      }
    }

    return chain;
  }

  /** Validate that a user has completed all prerequisites for a course */
  async validatePrerequisites(
    userId: string,
    courseId: string,
    adminOverride = false,
  ): Promise<{ satisfied: boolean; missing: string[] }> {
    if (adminOverride) return { satisfied: true, missing: [] };

    const prereqs = await this.prereqRepo.find({ where: { courseId } });
    if (!prereqs.length) return { satisfied: true, missing: [] };

    const completedEnrollments = await this.enrollmentRepo.find({
      where: { userId },
      select: ['courseId', 'completedAt'],
    });

    const completedCourseIds = new Set(
      completedEnrollments.filter((e) => e.completedAt).map((e) => e.courseId),
    );

    const missing = prereqs
      .filter((p) => !completedCourseIds.has(p.prerequisiteId))
      .map((p) => p.prerequisiteId);

    return { satisfied: missing.length === 0, missing };
  }

  /** Throws if prerequisites are not met (used by enrollment) */
  async enforcePrerequisites(userId: string, courseId: string, adminOverride = false): Promise<void> {
    const { satisfied, missing } = await this.validatePrerequisites(userId, courseId, adminOverride);
    if (satisfied) return;

    const missingCourses = await this.courseRepo.find({
      where: { id: In(missing) },
      select: ['id', 'title'],
    });
    const titleMap = new Map(missingCourses.map((c) => [c.id, c.title]));

    throw new UnprocessableEntityException({
      message: 'Prerequisites not completed',
      missingPrerequisites: missing.map((id) => ({
        courseId: id,
        title: titleMap.get(id) ?? null,
      })),
    });
  }

  /** Returns prerequisites with per-course progress for the given user */
  async getPrerequisiteStatus(courseId: string, userId: string) {
    const prereqs = await this.prereqRepo.find({
      where: { courseId },
      relations: ['prerequisite'],
    });

    if (!prereqs.length) return { allSatisfied: true, prerequisites: [] };

    const enrollments = await this.enrollmentRepo.find({
      where: { userId },
      select: ['courseId', 'completedAt'],
    });

    const enrollmentMap = new Map(enrollments.map((e) => [e.courseId, e]));

    const prerequisites = prereqs.map((p) => {
      const enrollment = enrollmentMap.get(p.prerequisiteId);
      return {
        courseId: p.prerequisiteId,
        title: p.prerequisite.title,
        completed: !!enrollment?.completedAt,
        enrolled: !!enrollment,
      };
    });

    return {
      allSatisfied: prerequisites.every((p) => p.completed),
      prerequisites,
    };
  }
}
