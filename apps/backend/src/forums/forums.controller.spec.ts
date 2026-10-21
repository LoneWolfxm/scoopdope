import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { ForumsController } from './forums.controller';
import { ForumsService } from './forums.service';

describe('ForumsController - Category Validation', () => {
  let app: INestApplication;
  let forumsService: ForumsService;

  const mockCategory = {
    id: 'category-1',
    name: 'Valid Name',
    description: 'Valid description',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockForumsService = {
    createCategory: jest.fn().mockResolvedValue(mockCategory),
    updateCategory: jest.fn().mockResolvedValue(mockCategory),
    findAllCategories: jest.fn().mockResolvedValue([mockCategory]),
    findCategoryById: jest.fn().mockResolvedValue(mockCategory),
    deleteCategory: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ForumsController],
      providers: [
        {
          provide: ForumsService,
          useValue: mockForumsService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    forumsService = moduleRef.get<ForumsService>(ForumsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /forums/categories (create)', () => {
    const validDescription = 'A valid description';

    it('should return 400 when name is 2 characters', async () => {
      await request(app.getHttpServer())
        .post('/forums/categories')
        .send({ name: 'ab', description: validDescription })
        .expect(400);

      expect(mockForumsService.createCategory).not.toHaveBeenCalled();
    });

    it('should accept name of exactly 3 characters', async () => {
      await request(app.getHttpServer())
        .post('/forums/categories')
        .send({ name: 'abc', description: validDescription })
        .expect(201);

      expect(mockForumsService.createCategory).toHaveBeenCalled();
    });

    it('should accept name of exactly 100 characters', async () => {
      const name = 'a'.repeat(100);

      await request(app.getHttpServer())
        .post('/forums/categories')
        .send({ name, description: validDescription })
        .expect(201);

      expect(mockForumsService.createCategory).toHaveBeenCalled();
    });

    it('should return 400 when name is 101 characters', async () => {
      const name = 'a'.repeat(101);

      await request(app.getHttpServer())
        .post('/forums/categories')
        .send({ name, description: validDescription })
        .expect(400);

      expect(mockForumsService.createCategory).not.toHaveBeenCalled();
    });

    it('should accept description of exactly 500 characters', async () => {
      const description = 'a'.repeat(500);

      await request(app.getHttpServer())
        .post('/forums/categories')
        .send({ name: 'Valid Name', description })
        .expect(201);

      expect(mockForumsService.createCategory).toHaveBeenCalled();
    });

    it('should return 400 when description is 501 characters', async () => {
      const description = 'a'.repeat(501);

      await request(app.getHttpServer())
        .post('/forums/categories')
        .send({ name: 'Valid Name', description })
        .expect(400);

      expect(mockForumsService.createCategory).not.toHaveBeenCalled();
    });

    it('should accept valid inputs within bounds', async () => {
      await request(app.getHttpServer())
        .post('/forums/categories')
        .send({ name: 'Valid Name', description: 'Valid description' })
        .expect(201);

      expect(mockForumsService.createCategory).toHaveBeenCalled();
    });
  });

  describe('PATCH /forums/categories/:id (update)', () => {
    const categoryId = 'category-1';
    const validDescription = 'A valid description';

    it('should return 400 when name is 2 characters', async () => {
      await request(app.getHttpServer())
        .patch(`/forums/categories/${categoryId}`)
        .send({ name: 'ab', description: validDescription })
        .expect(400);

      expect(mockForumsService.updateCategory).not.toHaveBeenCalled();
    });

    it('should accept name of exactly 3 characters', async () => {
      await request(app.getHttpServer())
        .patch(`/forums/categories/${categoryId}`)
        .send({ name: 'abc', description: validDescription })
        .expect(200);

      expect(mockForumsService.updateCategory).toHaveBeenCalled();
    });

    it('should accept name of exactly 100 characters', async () => {
      const name = 'a'.repeat(100);

      await request(app.getHttpServer())
        .patch(`/forums/categories/${categoryId}`)
        .send({ name, description: validDescription })
        .expect(200);

      expect(mockForumsService.updateCategory).toHaveBeenCalled();
    });

    it('should return 400 when name is 101 characters', async () => {
      const name = 'a'.repeat(101);

      await request(app.getHttpServer())
        .patch(`/forums/categories/${categoryId}`)
        .send({ name, description: validDescription })
        .expect(400);

      expect(mockForumsService.updateCategory).not.toHaveBeenCalled();
    });

    it('should accept description of exactly 500 characters', async () => {
      const description = 'a'.repeat(500);

      await request(app.getHttpServer())
        .patch(`/forums/categories/${categoryId}`)
        .send({ name: 'Valid Name', description })
        .expect(200);

      expect(mockForumsService.updateCategory).toHaveBeenCalled();
    });

    it('should return 400 when description is 501 characters', async () => {
      const description = 'a'.repeat(501);

      await request(app.getHttpServer())
        .patch(`/forums/categories/${categoryId}`)
        .send({ name: 'Valid Name', description })
        .expect(400);

      expect(mockForumsService.updateCategory).not.toHaveBeenCalled();
    });

    it('should accept valid inputs within bounds', async () => {
      await request(app.getHttpServer())
        .patch(`/forums/categories/${categoryId}`)
        .send({ name: 'Valid Name', description: 'Valid description' })
        .expect(200);

      expect(mockForumsService.updateCategory).toHaveBeenCalled();
    });
  });
});