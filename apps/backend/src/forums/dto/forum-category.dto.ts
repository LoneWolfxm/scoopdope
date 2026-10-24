import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateForumCategoryDto {
  @ApiProperty({
    description: 'Name of the forum category',
    minLength: 3,
    maxLength: 100,
    example: 'General Discussion',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    description: 'Description of the forum category',
    maxLength: 500,
    example: 'Talk about anything and everything.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateForumCategoryDto {
  @ApiPropertyOptional({
    description: 'Name of the forum category',
    minLength: 3,
    maxLength: 100,
    example: 'General Discussion',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Description of the forum category',
    maxLength: 500,
    example: 'Talk about anything and everything.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}