import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { IsOptional, IsDateString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnalyticsService, PlatformAnalyticsQuery } from './analytics.service';
import { SurveyPseudonymizationService } from './survey-pseudonymization.service';

class AnalyticsQueryDto implements PlatformAnalyticsQuery {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1')
export class AnalyticsController {
  constructor(
    private readonly service: AnalyticsService,
    private readonly pseudonymization: SurveyPseudonymizationService,
  ) {}

  @Get('analytics/platform')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Get platform-wide analytics (admin only)' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (ISO 8601)', example: '2025-01-01' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (ISO 8601)', example: '2025-12-31' })
  @ApiResponse({ status: 200, description: 'Platform analytics returned' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getPlatformAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.service.getPlatformAnalytics(query);
  }

  @Get('analytics/survey/pseudo-id/:pseudoId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Resolve a survey pseudoId back to a userId (admin only)' })
  @ApiParam({ name: 'pseudoId', description: 'HMAC pseudoId from the survey export', example: 'a1b2c3d4e5f6...' })
  @ApiResponse({ status: 200, description: 'Resolution result returned' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  resolvePseudoId(@Param('pseudoId') pseudoId: string) {
    return this.pseudonymization.resolvePseudoId(pseudoId);
  }

  @Get('courses/:id/analytics')
  @ApiOperation({ summary: 'Get aggregated analytics for a course' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getAnalytics(@Param('id') id: string) {
    return this.service.getAnalytics(id);
  }

  @Post('courses/:id/analytics/refresh')
  @ApiOperation({ summary: 'Force refresh analytics for a course' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  refresh(@Param('id') id: string) {
    return this.service.aggregateCourse(id);
  }
}
