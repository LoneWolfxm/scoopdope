import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CourseModule } from './course-module.entity';
import { Lesson } from '../lessons/lesson.entity';

@Injectable()
export class ModulesService {
  constructor(
    @InjectRepository(CourseModule) private repo: Repository<CourseModule>,
    private dataSource: DataSource,
  ) {}

  private withLockStatus(mod: CourseModule): CourseModule & { isLocked: boolean } {
    const isLocked = mod.releaseDate != null && new Date(mod.releaseDate) > new Date();
    return { ...mod, isLocked };
  }

  async findByCourse(courseId: string) {
    const modules = await this.repo.find({ where: { courseId }, order: { order: 'ASC' } });
    return modules.map((m) => this.withLockStatus(m));
  }

  async findOne(id: string) {
    const mod = await this.repo.findOne({ where: { id } });
    return mod ? this.withLockStatus(mod) : null;
  }

  /** Check if a module is accessible. Admins/instructors bypass the lock. */
  async assertAccessible(id: string, role?: string): Promise<void> {
    const mod = await this.repo.findOne({ where: { id } });
    if (!mod) throw new NotFoundException('Module not found');
    if (role === 'admin' || role === 'instructor') return;
    if (mod.releaseDate && new Date(mod.releaseDate) > new Date()) {
      throw new ForbiddenException(`Module is locked until ${mod.releaseDate.toISOString()}`);
    }
  }

  create(courseId: string, data: Partial<CourseModule>) {
    return this.repo.save(this.repo.create({ ...data, courseId }));
  }

  async update(id: string, data: Partial<CourseModule>) {
    const mod = await this.repo.findOne({ where: { id } });
    if (!mod) throw new NotFoundException('Module not found');
    return this.withLockStatus(await this.repo.save({ ...mod, ...data }));
  }

  async remove(id: string) {
    const mod = await this.repo.findOne({ where: { id } });
    if (!mod) throw new NotFoundException('Module not found');
    
    const courseId = mod.courseId;
    await this.repo.remove(mod);
    
    // Renumber remaining modules to fill gaps
    await this.rebuildPositions(courseId);
  }

  /**
   * Rebuild module positions (order field) to be contiguous starting from 0 or 1.
   * Fills any gaps left by deleted modules.
   * 
   * @param courseId - The course ID
   */
  private async rebuildPositions(courseId: string): Promise<void> {
    const modules = await this.repo.find({
      where: { courseId },
      order: { order: 'ASC' },
    });

    // Reassign sequential positions
    for (let i = 0; i < modules.length; i++) {
      modules[i].order = i + 1; // positions start from 1
      await this.repo.save(modules[i]);
    }
  }

  /**
   * Reorder modules by updating the order field.
   * After reordering, all positions are validated to be contiguous.
   * 
   * @param courseId - The course ID
   * @param moduleOrder - Array of module IDs in desired order
   * @throws {NotFoundException} if any module not found
   */
  async reorder(courseId: string, moduleOrder: string[]): Promise<CourseModule[]> {
    // Fetch all modules for this course
    const modules = await this.repo.find({ where: { courseId } });

    // Validate all requested module IDs exist
    const moduleMap = new Map(modules.map((m) => [m.id, m]));
    for (const moduleId of moduleOrder) {
      if (!moduleMap.has(moduleId)) {
        throw new NotFoundException(`Module ${moduleId} not found in course ${courseId}`);
      }
    }

    // Reorder modules and recompute lesson globalOrder atomically
    await this.dataSource.transaction(async (manager) => {
      const moduleRepo = manager.getRepository(CourseModule);
      const lessonRepo = manager.getRepository(Lesson);

      // Reorder modules according to the provided array
      for (let i = 0; i < moduleOrder.length; i++) {
        const module = moduleMap.get(moduleOrder[i])!;
        module.order = i + 1;
        await moduleRepo.save(module);
      }

      // Recompute globalOrder for all lessons across modules in their new order
      const orderedModules = await moduleRepo.find({
        where: { courseId },
        order: { order: 'ASC' },
      });

      let globalIndex = 0;
      for (const mod of orderedModules) {
        const lessons = await lessonRepo.find({
          where: { moduleId: mod.id },
          order: { order: 'ASC' },
        });
        for (const lesson of lessons) {
          lesson.globalOrder = globalIndex++;
          await lessonRepo.save(lesson);
        }
      }
    });

    // Return updated modules in order
    return this.repo.find({
      where: { courseId },
      order: { order: 'ASC' },
    });
  }

  /** Admin override: clear the release date to unlock immediately. */
  async unlockNow(id: string) {
    const mod = await this.repo.findOne({ where: { id } });
    if (!mod) throw new NotFoundException('Module not found');
    mod.releaseDate = null;
    return this.withLockStatus(await this.repo.save(mod));
  }

  /** Find modules whose releaseDate just passed (within the last minute). Used by the scheduler. */
  findJustUnlocked(): Promise<CourseModule[]> {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60_000);
    return this.repo
      .createQueryBuilder('m')
      .where('m.releaseDate <= :now', { now })
      .andWhere('m.releaseDate > :oneMinuteAgo', { oneMinuteAgo })
      .getMany();
  }
}
