import * as AdmZip from 'adm-zip';
import { PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import {
  MAX_ASSIGNMENT_UPLOAD_BYTES,
  validateAssignmentUpload,
} from './assignment-upload.validation';

function uploadFile(
  originalname: string,
  mimetype: string,
  buffer: Buffer
): Express.Multer.File {
  return {
    originalname,
    mimetype,
    buffer,
    size: buffer.length,
  } as Express.Multer.File;
}

describe('validateAssignmentUpload', () => {
  it.each([
    ['document.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n')],
    ['photo.png', 'image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['notes.txt', 'text/plain', Buffer.from('Assignment notes')],
    [
      'legacy.doc',
      'application/msword',
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ],
  ])('accepts valid %s content', (name, mime, content) => {
    expect(() => validateAssignmentUpload(uploadFile(name, mime, content))).not.toThrow();
  });

  it('accepts a ZIP-signature file only when it contains a valid Office document part', () => {
    const archive = new AdmZip();
    archive.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
    archive.addFile('word/document.xml', Buffer.from('<document/>'));

    expect(() =>
      validateAssignmentUpload(
        uploadFile(
          'assignment.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          archive.toBuffer()
        )
      )
    ).not.toThrow();
  });

  it.each([
    ['archive.zip', 'application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['archive.tar.gz', 'application/gzip', Buffer.from([0x1f, 0x8b, 0x08])],
    ['spoofed.pdf', 'application/pdf', Buffer.from('not a PDF')],
    ['archive.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ])('rejects disallowed or spoofed file %s with 422', (name, mime, content) => {
    expect(() => validateAssignmentUpload(uploadFile(name, mime, content))).toThrow(
      UnprocessableEntityException
    );
  });

  it('rejects an image MIME whose bytes identify a different format', () => {
    expect(() =>
      validateAssignmentUpload(uploadFile('spoofed.png', 'image/png', Buffer.from('%PDF-1.7')))
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects active SVG content', () => {
    expect(() =>
      validateAssignmentUpload(
        uploadFile('image.svg', 'image/svg+xml', Buffer.from('<svg><script>alert(1)</script></svg>'))
      )
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects files larger than 20 MiB with 413', () => {
    const tooLarge = Buffer.alloc(MAX_ASSIGNMENT_UPLOAD_BYTES + 1);
    expect(() =>
      validateAssignmentUpload(uploadFile('large.pdf', 'application/pdf', tooLarge))
    ).toThrow(PayloadTooLargeException);
  });
});