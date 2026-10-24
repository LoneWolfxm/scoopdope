import { Test, TestingModule } from '@nestjs/testing';
import { BookmarksController } from './bookmarks.controller';
import { BookmarksService } from './bookmarks.service';

describe('BookmarksController', () => {
  let controller: BookmarksController;
  let service: {
    findAll: jest.Mock;
  };

  const buildBookmarks = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `bookmark-${i + 1}`,
      userId: 'user-1',
      lessonId: `lesson-${i + 1}`,
    }));

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookmarksController],
      providers: [
        {
          provide: BookmarksService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<BookmarksController>(BookmarksController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should default to page 1 and limit 20 when no query params are provided', async () => {
      const data = buildBookmarks(20);
      service.findAll.mockResolvedValue({
        data,
        total: 45,
        page: 1,
        lastPage: 3,
      });

      const result = await controller.findAll('user-1', {});

      expect(service.findAll).toHaveBeenCalledWith('user-1', {
        page: 1,
        limit: 20,
      });
      expect(result).toEqual({
        data,
        total: 45,
        page: 1,
        lastPage: 3,
      });
      expect(result.data).toHaveLength(20);
    });

    it('should pass explicit page and limit to the service', async () => {
      const data = buildBookmarks(10);
      service.findAll.mockResolvedValue({
        data,
        total: 35,
        page: 2,
        lastPage: 4,
      });

      const result = await controller.findAll('user-1', {
        page: 2,
        limit: 10,
      });

      expect(service.findAll).toHaveBeenCalledWith('user-1', {
        page: 2,
        limit: 10,
      });
      expect(result).toEqual({
        data,
        total: 35,
        page: 2,
        lastPage: 4,
      });
    });

    it('should cap limit at 100', async () => {
      const data = buildBookmarks(100);
      service.findAll.mockResolvedValue({
        data,
        total: 250,
        page: 1,
        lastPage: 3,
      });

      const result = await controller.findAll('user-1', {
        page: 1,
        limit: 500,
      });

      expect(service.findAll).toHaveBeenCalledWith('user-1', {
        page: 1,
        limit: 100,
      });
      expect(result.data).toHaveLength(100);
      expect(result.total).toBe(250);
      expect(result.page).toBe(1);
      expect(result.lastPage).toBe(3);
    });

    it('should return the { data, total, page, lastPage } response envelope', async () => {
      const data = buildBookmarks(5);
      service.findAll.mockResolvedValue({
        data,
        total: 5,
        page: 1,
        lastPage: 1,
      });

      const result = await controller.findAll('user-1', {
        page: 1,
        limit: 20,
      });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('lastPage');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.lastPage).toBe(1);
    });

    it('should coerce string query params to numbers', async () => {
      const data = buildBookmarks(20);
      service.findAll.mockResolvedValue({
        data,
        total: 60,
        page: 3,
        lastPage: 3,
      });

      const result = await controller.findAll('user-1', {
        page: '3' as unknown as number,
        limit: '20' as unknown as number,
      });

      expect(service.findAll).toHaveBeenCalledWith('user-1', {
        page: 3,
        limit: 20,
      });
      expect(result.page).toBe(3);
    });
  });
});