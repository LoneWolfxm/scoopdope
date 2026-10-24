import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Sanitize, Trim } from 'class-sanitizer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { RichHtmlSanitizer } from '../../common/sanitizers/rich-html.sanitizer';
import { StripHtmlSanitizer } from '../../common/sanitizers/strip-html.sanitizer';

export class CreatePostDto {
  @ApiProperty({ description: 'Forum post title' })
  @IsString()
  @Trim()
  @Sanitize(StripHtmlSanitizer)
  title: string;

  @ApiProperty({ description: 'Forum post content' })
  @IsString()
  @Trim()
  @Sanitize(RichHtmlSanitizer)
  content: string;

  @ApiPropertyOptional({ description: 'Pin the post (instructors/admins only)', default: false })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}
