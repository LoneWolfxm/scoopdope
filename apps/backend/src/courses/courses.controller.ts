import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Header,
  Request,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CoursesService } from './courses.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CourseQueryDto } from './dto/course-query.dto';
import { ScheduleCourseDto } from './dto/schedule-course.dto';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-log.entity';
import { CourseStatus } from './course.entity';

/** Allowed MIME types for course thumbnails */
const THUMBNAIL_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

/** 2 MB in bytes */
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/** ISO 639-1 codes supported by the i18n system */
const SUPPORTED_LANGUAGES = new Set(['en', 'fr', 'ar', 'es']);

@ApiTags('courses')
@Controller('v1/courses')
export class CoursesController {
  constructor(
    private coursesService: CoursesService,
    private auditService: AuditService,
  ) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Get all published courses' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by title or description (ILIKE)',
  })
  @ApiQuery({
    name: 'level',
    required: false,
    enum: ['beginner', 'intermediate', 'advanced'],
    description: 'Filter by level',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Filter by course category',
  })
  @ApiQuery({
    name: 'language',
    required: false,
    enum: ['en', 'fr', 'ar', 'es'],
    description: 'Filter by ISO 639-1 language code (en, fr, ar, es)',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    description: 'Filter by category UUID',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Filter by category slug (e.g. "blockchain")',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Results per page (default: 20)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated published courses',
    schema: { example: { data: [], total: 0, page: 1, limit: 20 } },
  })
  findAll(@Query() query: CourseQueryDto = {}) {
    return this.coursesService.findAll({
      ...query,
      language: this.normalizeLanguage(query.language),
    });
  }

  /**
   * Validates the optional `difficulty` query param against the allowed levels.
   * Returns `undefined` when the param is absent so the service can auto-detect.
   */
  private parseDifficulty(
    difficulty?: string,
  ): 'beginner' | 'intermediate' | 'advanced' | undefined {
    if (difficulty === undefined || difficulty === null || difficulty === '') {
      return undefined;
    }
    const normalized = String(difficulty).trim().toLowerCase();
    if (
      normalized !== 'beginner' &&
      normalized !== 'intermediate' &&
      normalized !== 'advanced'
    ) {
      throw new BadRequestException(
        'difficulty must be one of: beginner, intermediate, advanced',
      );
    }
    return normalized;
  }

  @Get('recommendations')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Get difficulty-aware course recommendations for the current learner',
  })
  @ApiQuery({
    name: 'difficulty',
    required: false,
    enum: ['beginner', 'intermediate', 'advanced'],
    description:
      'Override the auto-detected learner level (defaults to the level derived from completed courses, or beginner when there is no history)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns courses at most one level above the learner level',
    schema: { example: { data: [], learnerLevel: 'beginner', difficulty: 'beginner' } },
  })
  @ApiResponse({ status: 400, description: 'Invalid difficulty value' })
  recommendations(
    @Query('difficulty') difficulty?: string,
    @Request() req?: { user?: { id: string; role: string } },
  ) {
    const override = this.parseDifficulty(difficulty);
    return this.coursesService.getRecommendations(req?.user?.id, override);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search published courses by title and description' })
  @ApiQuery({ name: 'q', required: false, description: 'Search query; empty returns all courses' })
  @ApiQuery({
    name: 'language',
    required: false,
    enum: ['en', 'fr', 'ar', 'es'],
    description: 'Filter by ISO 639-1 language code (en, fr, ar, es)',
  })
  @ApiResponse({ status: 200, description: 'Ranked, paginated course search results' })
  search(@Query() query: CourseQueryDto) {
    return this.coursesService.search(
      query.q ?? query.search ?? '',
      query.page,
      query.limit,
      this.normalizeLanguage(query.language),
    );
  }

  /**
   * Validates and normalizes the `language` query param.
   * Returns undefined when absent; throws 400 for unsupported codes.
   */
  private normalizeLanguage(language?: string): string | undefined {
    if (language === undefined || language === null || language === '') {
      return undefined;
    }
    const normalized = String(language).trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.has(normalized)) {
      throw new BadRequestException(
        `Unsupported language "${language}". Supported values: ${[...SUPPORTED_LANGUAGES].join(', ')}`,
      );
    }
    return normalized;
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get a course by ID' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({
    status: 200,
    description: 'Returns a single course including instructor profile details',
    schema: {
      example: {
        data: {
          id: 'uuid',
          title: 'Intro to Stellar',
          instructor: {
            id: 'uuid',
            name: 'Jane Doe',
            avatarUrl: 'https://example.com/avatar.png',
            bio: 'Blockchain educator',
          },
        },
        statusCode: 200,
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Course not found, or not visible to the requester (draft/pending courses)',
  })
  findOne(
    @Param('id') id: string,
    @Request() req: { user?: { id: string; role: string } },
  ) {
    return this.coursesService.findOneForViewer(id, req.user);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'instructor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new course' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiBody({
    schema: {
      example: {
        title: 'Intro to Stellar',
        description: 'Learn Stellar basics',
        level: 'beginner',
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Course created successfully',
    schema: { example: { data: {}, statusCode: 201, timestamp: '2024-01-01T00:00:00.000Z' } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  async create(
    @Body() data: any,
    @Request() req: { user?: { id: string; role: string } },
  ) {
    const course = await this.coursesService.create(data);
    await this.auditService.log({
      userId: req.user?.id,
      action: AuditAction.COURSE_CREATE,
      entityType: 'course',
      entityId: course?.id,
      metadata: { title: course?.title },
    });
    return course;
  }

  @Post('import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk import courses from a CSV file' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Import summary with created and failed rows',
    schema: {
      example: {
        created: 2,
        failed: 1,
        errors: [{ row: 3, message: 'title is required' }],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Missing or invalid CSV file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  async importCsv(@UploadedFile() file?: { buffer: Buffer; originalname?: string }) {
    if (!file || !file.buffer) {
      throw new BadRequestException('CSV file is required');
    }

    const rows = parseCsv(file.buffer.toString('utf-8'));
    if (rows.length === 0) {
      throw new BadRequestException('CSV file contains no data rows');
    }

    const created: any[] = [];
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // account for header row
      const row = rows[i];
      const title = (row.title ?? '').trim();
      if (!title) {
        errors.push({ row: rowNumber, message: 'title is required' });
        continue;
      }
      try {
        const course = await this.coursesService.create({
          title,
          description: row.description?.trim() || undefined,
          level: row.level?.trim() || undefined,
          category: row.category?.trim() || undefined,
          language: row.language?.trim() || undefined,
        });
        created.push(course);
      } catch (err: any) {
        errors.push({ row: rowNumber, message: err?.message ?? 'Failed to create course' });
      }
    }

    return { created: created.length, failed: errors.length, errors };
  }

  @Patch(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'instructor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish a draft course' })
  @ApiResponse({ status: 200, description: 'Course published successfully' })
  @ApiResponse({ status: 400, description: 'Course is not in a publishable state' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Course not found' })
  async publish(
    @Param('id') id: string,
    @Request() req: { user?: { id: string; role: string } },
  ) {
    const course = await this.coursesService.publish(id, req.user);
    await this.auditService.log({
      userId: req.user?.id,
      action: AuditAction.COURSE_UPDATE,
      entityType: 'course',
      entityId: course?.id,
      metadata: { status: CourseStatus.PUBLISHED },
    });
    return course;
  }

  @Patch(':id/unpublish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'instructor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revert a published course back to draft' })
  @ApiResponse({ status: 200, description: 'Course reverted to draft' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Course not found' })
  async unpublish(
    @Param('id') id: string,
    @Request() req: { user?: { id: string; role: string } },
  ) {
    const course = await this.coursesService.unpublish(id, req.user);
    await this.auditService.log({
      userId: req.user?.id,
      action: AuditAction.COURSE_UPDATE,
      entityType: 'course',
      entityId: course?.id,
      metadata: { status: CourseStatus.DRAFT },
    });
    return course;
  }
}
