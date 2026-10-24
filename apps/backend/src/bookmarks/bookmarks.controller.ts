import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BookmarksService } from './bookmarks.service';

export class BookmarksPaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

@ApiTags('bookmarks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1')
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  /**
   * Toggle bookmark on a lesson (add if not bookmarked, remove if already bookmarked).
   * POST /v1/lessons/:id/bookmark
   */
  @Post('lessons/:id/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle bookmark on a lesson' })
  @ApiParam({ name: 'id', description: 'Lesson ID' })
  @ApiResponse({ status: 200, description: 'Bookmark toggled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Lesson not found' })
  async toggleBookmark(@Param('id') lessonId: string, @Request() req: any) {
    const userId = req.user.id ?? req.user.sub;
    return this.bookmarksService.toggleBookmark(userId, lessonId);
  }

  /**
   * Explicitly add a bookmark.
   * POST /v1/lessons/:id/bookmark/add
   */
  @Post('lessons/:id/bookmark/add')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bookmark a lesson' })
  @ApiParam({ name: 'id', description: 'Lesson ID' })
  @ApiResponse({ status: 201, description: 'Lesson bookmarked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async addBookmark(@Param('id') lessonId: string, @Request() req: any) {
    const userId = req.user.id ?? req.user.sub;
    return this.bookmarksService.addBookmark(userId, lessonId);
  }

  /**
   * Remove a bookmark.
   * DELETE /v1/lessons/:id/bookmark
   */
  @Delete('lessons/:id/bookmark')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove bookmark from a lesson' })
  @ApiParam({ name: 'id', description: 'Lesson ID' })
  @ApiResponse({ status: 204, description: 'Bookmark removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Bookmark not found' })
  async removeBookmark(@Param('id') lessonId: string, @Request() req: any) {
    const userId = req.user.id ?? req.user.sub;
    await this.bookmarksService.removeBookmark(userId, lessonId);
  }

  /**
   * Get bookmark status for a lesson.
   * GET /v1/lessons/:id/bookmark
   */
  @Get('lessons/:id/bookmark')
  @ApiOperation({ summary: 'Get bookmark status for a lesson' })
  @ApiParam({ name: 'id', description: 'Lesson ID' })
  @ApiResponse({ status: 200, description: 'Bookmark status returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getBookmarkStatus(@Param('id') lessonId: string, @Request() req: any) {
    const userId = req.user.id ?? req.user.sub;
    const bookmarked = await this.bookmarksService.isBookmarked(userId, lessonId);
    return { bookmarked };
  }

  /**
   * Get all bookmarks for the current user (dashboard endpoint).
   * GET /v1/bookmarks
   */
  @Get('bookmarks')
  @ApiOperation({ summary: 'Get paginated bookmarked lessons for the current user' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default 1)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default 20, max 100)',
  })
  @ApiResponse({ status: 200, description: 'Paginated bookmarks list returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyBookmarks(
    @Request() req: any,
    @Query() query: BookmarksPaginationQueryDto,
  ) {
    const userId = req.user.id ?? req.user.sub;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const { data, total } = await this.bookmarksService.getUserBookmarksPaginated(
      userId,
      page,
      limit,
    );
    const lastPage = Math.max(Math.ceil(total / limit), 1);
    return { data, total, page, lastPage };
  }
}
