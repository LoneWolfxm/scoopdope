import { ApiProperty } from '@nestjs/swagger';
import { PublicUserProfileDto } from './public-user-profile.dto';

export class PrivateUserProfileDto extends PublicUserProfileDto {
  @ApiProperty({ description: 'User email address' })
  email: string;

  @ApiProperty({ description: 'User phone number', required: false })
  phoneNumber?: string;

  @ApiProperty({ description: 'KYC verification status' })
  kycStatus: string;

  @ApiProperty({ description: 'Account role' })
  role: string;

  @ApiProperty({ description: 'Account creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}
