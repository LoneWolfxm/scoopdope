import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { CreatePostDto } from '../../forums/dto/create-post.dto';
import { RichHtmlSanitizer } from '../sanitizers/rich-html.sanitizer';

@Injectable()
export class SanitizationPipe implements PipeTransform {
  async transform(value: any, metadata?: ArgumentMetadata) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    // Recursively sanitize string values
    const sanitized = this.sanitizeObject(value, metadata?.metatype === CreatePostDto);
    return sanitized;
  }

  private sanitizeObject(obj: any, forumPost = false): any {
    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item));
    }

    if (obj !== null && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          sanitized[key] =
            forumPost && key === 'content' && typeof obj[key] === 'string'
              ? this.sanitizeString(obj[key], true)
              : this.sanitizeObject(obj[key]);
        }
      }
      return sanitized;
    }

    return obj;
  }

  private sanitizeString(str: string, allowSafeHtml = false): string {
    if (typeof str !== 'string') {
      return str;
    }

    // Remove null bytes
    str = str.replace(/\0/g, '');

    // Trim whitespace
    str = str.trim();

    if (allowSafeHtml) {
      return new RichHtmlSanitizer().sanitize(str);
    }

    // Sanitize HTML
    str = sanitizeHtml(str, {
      allowedTags: [],
      allowedAttributes: {},
    });

    return str;
  }
}
