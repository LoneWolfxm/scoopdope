import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycService } from './kyc.service';
import { SubmitKycDocumentsDto } from './dto/submit-kyc-documents.dto';

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private kycService: KycService) {}

  @Get('status/:stellarPublicKey')
  @ApiOperation({ summary: 'SEP-0012: get KYC status for a Stellar account' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 200, description: 'Returns KYC status record' })
  getStatus(@Param('stellarPublicKey') stellarPublicKey: string) {
    return this.kycService.getStatus(stellarPublicKey);
  }

  @Put('customer')
  @ApiOperation({ summary: 'SEP-0012: submit or update KYC fields' })
  @ApiResponse({ status: 200, description: 'KYC submission accepted' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  upsertCustomer(@Body() body: { stellarPublicKey: string; [key: string]: string }) {
    const { stellarPublicKey, ...fields } = body;
    return this.kycService.upsertCustomer(stellarPublicKey, fields);
  }

  @Post('documents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit identity documents for KYC verification' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 201, description: 'Documents submitted, KYC status set to pending' })
  @ApiResponse({ status: 200, description: 'Documents submitted, KYC status set to pending' })
  submitDocuments(@Body() dto: SubmitKycDocumentsDto) {
    return this.kycService.submitDocuments(dto);
  }

  /** Webhook called by the KYC provider when verification status changes */
  @Post('webhook')
  @ApiOperation({ summary: 'KYC provider webhook — status update callback' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async webhook(@Body() payload: any) {
    await this.kycService.handleWebhook(payload);
    return { received: true };
  }
}
