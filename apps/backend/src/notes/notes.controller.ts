import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { NotesService } from './notes.service';
import { CreateNoteDto, UpdateNoteDto } from './note.dto';

@ApiTags('notes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1')
export class NotesController {
  constructor(private service: NotesService) {}

  @Get('lessons/:lessonId/notes')
  @ApiOperation({ summary: 'Get notes for a lesson' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiQuery({ name: 'search', required: false })
  getByLesson(
    @Param('lessonId') lessonId: string,
    @Query('search') search: string,
    @CurrentUser() user: any,
  ) {
    return this.service.findByLesson(user.id, lessonId, search);
  }

  @Get('notes/search')
  @ApiOperation({ summary: 'Full-text search across the current user\'s notes' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiQuery({ name: 'q', required: true, description: 'Full-text search query' })
  search(@Query('q') q: string, @CurrentUser() user: any) {
    return this.service.search(user.id, q);
  }

  @Get('notes')
  @ApiOperation({ summary: 'Get all notes for the current user' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiQuery({ name: 'search', required: false })
  getAll(@Query('search') search: string, @CurrentUser() user: any) {
    return this.service.findByUser(user.id, search);
  }

  @Post('lessons/:lessonId/notes')
  @ApiOperation({ summary: 'Create a note' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  create(
    @Param('lessonId') lessonId: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: any,
  ) {
    return this.service.create(user.id, lessonId, dto);
  }

  @Patch('notes/:id')
  @ApiOperation({ summary: 'Update a note' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  update(@Param('id') id: string, @Body() dto: UpdateNoteDto, @CurrentUser() user: any) {
    return this.service.update(id, user.id, dto);
  }

  @Delete('notes/:id')
  @ApiOperation({ summary: 'Delete a note' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user.id);
  }
}
