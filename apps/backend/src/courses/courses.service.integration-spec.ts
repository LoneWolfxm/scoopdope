import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { DataSource } from 'typeorm';
import { CoursesService } from './courses.service';
import { Course, CourseStatus } from './course.entity';
import { CourseModule } from '../modules/module.entity';
import { Lesson } from '../lessons/lesson.entity';
import { Quiz } from '../quizzes/quiz.entity';
import { Enrollment } from '../enrollments/enrollment.entity';
import { SearchService } from '../search/search.service';
import { setupTestDatabase, teardownTestDatabase } from '../test/integration-test.setup';

describe('CoursesService (Integration)', () => {
  let service: CoursesService;
  let module: TestingModule;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await setupTestDatabase();

    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forFeature([Course, CourseModule, Lesson, Quiz, Enrollment]),
        CacheModule.register(),
      ],
      providers: [
        CoursesService,
        {
          provide: SearchService,
          useValue: {
            indexCourse: jest.fn(),
            deleteFromIndex: jest.fn(),
          },
        },
      ],
    })
      .overrideProvider('DataSource')
      .useValue(dataSource)
      .compile();

    service = module.get<CoursesService>(CoursesService);
  });

  afterAll(async () => {
    await module.close();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    const repo = dataSource.getRepository(Course);
    await repo.clear();
  });

  describe('create', () => {
    it('should create a course', async () => {
      const courseData = {
        title: 'Blockchain Basics',
        description: 'Learn blockchain fundamentals',
        level: 'beginner',
        isPublished: true,
      };

      const course = await service.create(courseData);

      expect(course).toBeDefined();
      expect(course.title).toBe(courseData.title);
      expect(course.description).toBe(courseData.description);
    });
  });

  describe('findAll', () => {
    it('should return published courses', async () => {
      await service.create({
        title: 'Course 1',
        description: 'Desc 1',
        level: 'beginner',
        isPublished: true,
        status: CourseStatus.PUBLISHED,
      });

      await service.create({
        title: 'Course 2',
        description: 'Desc 2',
        level: 'intermediate',
        isPublished: false,
        status: CourseStatus.DRAFT,
      });

      const result = await service.findAll();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].title).toBe('Course 1');
      expect(result.total).toBe(1);
    });

    it('should filter by search term', async () => {
      await service.create({
        title: 'Stellar Blockchain',
        description: 'Learn Stellar',
        level: 'beginner',
        isPublished: true,
        status: CourseStatus.PUBLISHED,
      });

      await service.create({
        title: 'Solana Blockchain',
        description: 'Learn Solana',
        level: 'beginner',
        isPublished: true,
        status: CourseStatus.PUBLISHED,
      });

      const result = await service.findAll({ search: 'Stellar' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].title).toContain('Stellar');
    });

    it('should filter by level', async () => {
      await service.create({
        title: 'Beginner Course',
        description: 'Desc',
        level: 'beginner',
        isPublished: true,
        status: CourseStatus.PUBLISHED,
      });

      await service.create({
        title: 'Advanced Course',
        description: 'Desc',
        level: 'advanced',
        isPublished: true,
        status: CourseStatus.PUBLISHED,
      });

      const result = await service.findAll({ level: 'beginner' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].level).toBe('beginner');
    });
  });

  describe('findOne', () => {
    it('should return a course by id', async () => {
      const created = await service.create({
        title: 'Test Course',
        description: 'Test',
        level: 'beginner',
        isPublished: true,
      });

      const found = await service.findOne(created.id);

      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
      expect(found.title).toBe('Test Course');
    });

    it('should throw NotFoundException for non-existent course', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow('Course not found');
    });
  });

  describe('update', () => {
    it('should update a course', async () => {
      const created = await service.create({
        title: 'Original Title',
        description: 'Original Desc',
        level: 'beginner',
        isPublished: true,
      });

      const updated = await service.update(created.id, {
        title: 'Updated Title',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.description).toBe('Original Desc');
    });
  });

  describe('publishNow', () => {
    it('should set publishedAt when publishing a course', async () => {
      const created = await service.create({
        title: 'To Publish',
        description: 'Desc',
        level: 'beginner',
        isPublished: false,
        status: CourseStatus.DRAFT,
      });

      const published = await service.publishNow(created.id);

      expect(published.status).toBe(CourseStatus.PUBLISHED);
      expect(published.isPublished).toBe(true);
      expect(published.publishedAt).toBeDefined();
      expect(published.publishedAt).toBeInstanceOf(Date);
    });
  });

  describe('delete', () => {
    it('should delete a course', async () => {
      const created = await service.create({
        title: 'To Delete',
        description: 'Desc',
        level: 'beginner',
        isPublished: true,
      });

      await service.delete(created.id);

      await expect(service.findOne(created.id)).rejects.toThrow('Course not found');
    });
  });

  describe('cascade delete', () => {
    const seedCourseTree = async () => {
      const course = await service.create({
        title: 'Cascade Course',
        description: 'Desc',
        level: 'beginner',
        isPublished: true,
      });

      const moduleRepo = dataSource.getRepository(CourseModule);
      const lessonRepo = dataSource.getRepository(Lesson);
      const quizRepo = dataSource.getRepository(Quiz);
      const enrollmentRepo = dataSource.getRepository(Enrollment);

      const courseModule = await moduleRepo.save(
        moduleRepo.create({ title: 'Module 1', courseId: course.id, course } as any),
      );

      const lesson = await lessonRepo.save(
        lessonRepo.create({
          title: 'Lesson 1',
          moduleId: courseModule.id,
          courseModule,
        } as any),
      );

      const quiz = await quizRepo.save(
        quizRepo.create({ title: 'Quiz 1', lessonId: lesson.id, lesson } as any),
      );

      const enrollment = await enrollmentRepo.save(
        enrollmentRepo.create({ courseId: course.id, course, userId: 'user-1' } as any),
      );

      return { course, courseModule, lesson, quiz, enrollment };
    };

    it('should cascade delete modules, lessons, quizzes and enrollments via ORM', async () => {
      const { course, courseModule, lesson, quiz, enrollment } = await seedCourseTree();

      await service.delete(course.id);

      expect(await dataSource.getRepository(CourseModule).findOneBy({ id: courseModule.id })).toBeNull();
      expect(await dataSource.getRepository(Lesson).findOneBy({ id: lesson.id })).toBeNull();
      expect(await dataSource.getRepository(Quiz).findOneBy({ id: quiz.id })).toBeNull();
      expect(await dataSource.getRepository(Enrollment).findOneBy({ id: enrollment.id })).toBeNull();
    });

    it('should cascade delete via database-level FK constraints', async () => {
      const { course, courseModule, lesson, quiz, enrollment } = await seedCourseTree();

      // Bypass the ORM cascade and rely solely on ON DELETE CASCADE constraints.
      await dataSource.query('DELETE FROM courses WHERE id = $1', [course.id]);

      const moduleCount = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM course_modules WHERE id = $1',
        [courseModule.id],
      );
      const lessonCount = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM lessons WHERE id = $1',
        [lesson.id],
      );
      const quizCount = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM quizzes WHERE id = $1',
        [quiz.id],
      );
      const enrollmentCount = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM enrollments WHERE id = $1',
        [enrollment.id],
      );

      expect(moduleCount[0].count).toBe(0);
      expect(lessonCount[0].count).toBe(0);
      expect(quizCount[0].count).toBe(0);
      expect(enrollmentCount[0].count).toBe(0);
    });
  });
});
