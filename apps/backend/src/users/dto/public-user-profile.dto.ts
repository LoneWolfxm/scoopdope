import { ApiProperty } from '@nestjs/swagger';

export class PublicUserProfileDto {
  @ApiProperty({ description: 'Public display name of the user' })
  displayName: string;

  @ApiProperty({ description: 'URL of the user avatar', nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Short biography', nullable: true })
  bio: string | null;

  @ApiProperty({
    description: 'Courses the user is enrolled in',
    type: [String],
  })
  courses: string[];
}
