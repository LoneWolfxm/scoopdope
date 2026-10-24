import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssignmentsService } from './assignments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AssignmentOwnershipGuard } from './assignment-ownership.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import { RubricScore } from './peer-review.entity';
import { User } from '../users/user.entity';
import { MAX_ASSIGNMENT_UPLOAD_BYTES, validateAssignmentUpload } from './assignment-upload.validation';

interface CreateAssignmentPayload {
  title: string;
  description?: string;
  courseId?: string;
  dueDate?: string | Date;
}

@ApiTags('assignments')
@Controller('assignments')
export class AssignmentsController {
  constructor(private assignmentsService: AssignmentsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'instructor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new assignment' })
  createAssignment(@Body() data: CreateAssignmentPayload) {
    return this.assignmentsService.createAssignment({
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    });
  }

  @Get('course/:courseId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get assignments for a course' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getAssignmentsByCourse(@Param('courseId') courseId: string) {
    return this.assignmentsService.getAssignmentsByCourse(courseId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get assignment details' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getAssignment(@Param('id') id: string) {
    return this.assignmentsService.getAssignment(id);
  }

  @Post(':id/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ASSIGNMENT_UPLOAD_BYTES } }))
  @ApiOperation({ summary: 'Submit an assignment' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 413, description: 'Uploaded file exceeds the 20 MB limit' })
  @ApiResponse({ status: 422, description: 'File type or file content is not allowed' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async submitAssignment(
    @CurrentUser() user: Pick<User, 'id'>,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    validateAssignmentUpload(file);
    // In a real app, you would upload the file to S3/CDN here.
    // For this implementation, we'll simulate it by using the filename or a mock URL.
    const fileUrl = `https://cdn.scoopdope.com/submissions/${user.id}/${file.originalname}`;
    return this.assignmentsService.submitAssignment(user.id, id, fileUrl);
  }

  @Get(':id/my-submission')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user submission for an assignment' })
  getMySubmission(@CurrentUser() user: Pick<User, 'id'>, @Param('id') id: string) {
    return this.assignmentsService.getSubmissionByUser(user.id, id);
  }

  @Post(':id/assign-reviewers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'instructor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trigger reviewer assignment for an assignment' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  assignReviewers(@Param('id') id: string) {
    return this.assignmentsService.assignReviewers(id);
  }

  @Get('my-reviews')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get peer reviews assigned to the current user' })
  getMyReviews(@CurrentUser() user: Pick<User, 'id'>) {
    return this.assignmentsService.getReviewsForUser(user.id);
  }

  @Post('reviews/:submissionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a peer review' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  submitReview(
    @CurrentUser() user: Pick<User, 'id'>,
    @Param('submissionId') submissionId: string,
    @Body() data: { scores: RubricScore[]; overallFeedback: string },
  ) {
    return this.assignmentsService.submitPeerReview(
      user.id,
      submissionId,
      data.scores,
      data.overallFeedback,
    );
  }

  @Patch('submissions/:id/override')
  @UseGuards(JwtAuthGuard, RolesGuard, AssignmentOwnershipGuard)
  @Roles('admin', 'instructor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Instructor override for submission grade' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  instructorOverride(
    @Param('id') id: string,
    @Body() data: { grade: number; feedback: string },
  ) {
    return this.assignmentsService.instructorOverride(id, data.grade, data.feedback);
  }
}
