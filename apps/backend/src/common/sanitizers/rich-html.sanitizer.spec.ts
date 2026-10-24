import { CreatePostDto } from '../../forums/dto/create-post.dto';
import { SanitizationPipe } from '../pipes/sanitization.pipe';
import { RichHtmlSanitizer } from './rich-html.sanitizer';

describe('RichHtmlSanitizer', () => {
  const sanitizer = new RichHtmlSanitizer();

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<a href="javascript:alert(1)">click</a>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<div onmouseover=alert(1)>hover</div>',
    '<body onload=alert(1)>',
    '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
  ])('removes unsafe markup from %s', (payload) => {
    const sanitized = sanitizer.sanitize(payload);

    expect(sanitized).not.toMatch(
      /<script|<img|<svg|<iframe|<body|<math|onerror\s*=|onload\s*=|onmouseover\s*=|javascript:/i
    );
  });

  it('preserves safe formatting tags', () => {
    expect(sanitizer.sanitize('<p><strong>Bold</strong> and <em>italic</em></p>')).toBe(
      '<p><strong>Bold</strong> and <em>italic</em></p>'
    );
  });

  it('preserves safe formatting in forum post content through the global sanitizer', async () => {
    const pipe = new SanitizationPipe();
    const sanitized = await pipe.transform(
      { title: 'Title', content: '<p><strong>Bold</strong><img src=x onerror=alert(1)></p>' },
      { type: 'body', metatype: CreatePostDto, data: '' }
    );

    expect(sanitized.content).toBe('<p><strong>Bold</strong></p>');
  });
});
