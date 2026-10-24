import { BadRequestException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import * as AdmZip from 'adm-zip';

export const MAX_ASSIGNMENT_UPLOAD_BYTES = 20 * 1024 * 1024;

const OOXML_MAIN_PARTS: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/document.xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template': 'word/document.xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xl/workbook.xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template': 'xl/workbook.xml',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt/presentation.xml',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow': 'ppt/presentation.xml',
  'application/vnd.openxmlformats-officedocument.presentationml.template': 'ppt/presentation.xml',
};

const IMAGE_SIGNATURES: Record<string, (buffer: Buffer) => boolean> = {
  'image/jpeg': (buffer) =>
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/gif': (buffer) => ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)),
  'image/webp': (buffer) =>
    buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP',
  'image/bmp': (buffer) => buffer.toString('ascii', 0, 2) === 'BM',
  'image/tiff': (buffer) =>
    buffer.length >= 4 &&
    (buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
      buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))),
  'image/x-icon': (buffer) =>
    buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00])),
  'image/vnd.microsoft.icon': (buffer) =>
    buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00])),
  'image/avif': (buffer) => hasIsoBmffBrand(buffer, ['avif', 'avis']),
  'image/heic': (buffer) => hasIsoBmffBrand(buffer, ['heic', 'heix', 'hevc', 'hevx']),
};

function hasIsoBmffBrand(buffer: Buffer, brands: string[]): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp' &&
    brands.some((brand) => buffer.toString('ascii', 8, 12) === brand)
  );
}

function hasSafeSvgSignature(buffer: Buffer): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return false;
  }

  return (
    /^\s*(?:<\?xml\s[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(text) &&
    !/<\s*(?:script|foreignObject)\b/i.test(text) &&
    !/\bon[a-z]+\s*=/i.test(text) &&
    !/javascript\s*:/i.test(text) &&
    !/<!DOCTYPE|<!ENTITY/i.test(text)
  );
}

function hasZipSignature(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]) && [0x04, 0x06, 0x08].includes(buffer[3]);
}

function hasValidOpenXmlPackage(mimetype: string, buffer: Buffer): boolean {
  const mainPart = OOXML_MAIN_PARTS[mimetype];
  if (!mainPart || !hasZipSignature(buffer)) return false;

  try {
    const archive = new AdmZip(buffer);
    return archive.getEntry('[Content_Types].xml') !== null && archive.getEntry(mainPart) !== null;
  } catch {
    return false;
  }
}

function matchesMagicBytes(mimetype: string, originalname: string, buffer: Buffer): boolean {
  if (mimetype === 'application/pdf') {
    return buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-';
  }

  if (mimetype === 'application/msword') {
    return (
      /\.doc$/i.test(originalname) &&
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    );
  }

  if (mimetype === 'text/plain') {
    if (buffer.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return true;
    } catch {
      return false;
    }
  }

  if (mimetype === 'image/svg+xml') return hasSafeSvgSignature(buffer);
  if (IMAGE_SIGNATURES[mimetype]) return IMAGE_SIGNATURES[mimetype](buffer);
  if (mimetype.startsWith('application/vnd.openxmlformats-officedocument.')) {
    return hasValidOpenXmlPackage(mimetype, buffer);
  }

  return false;
}

export function validateAssignmentUpload(file?: Express.Multer.File): void {
  if (!file) throw new BadRequestException('No file uploaded');
  if (file.size > MAX_ASSIGNMENT_UPLOAD_BYTES) {
    throw new PayloadTooLargeException('Assignment files must be 20 MB or smaller');
  }

  const mimetype = file.mimetype.toLowerCase().split(';', 1)[0].trim();
  if (/\.(?:zip|tar|tgz|gz|rar|7z|bz2|xz)$/i.test(file.originalname)) {
    throw new UnprocessableEntityException('Archive files are not allowed');
  }

  const allowedMime =
    mimetype === 'application/pdf' ||
    mimetype === 'application/msword' ||
    mimetype === 'text/plain' ||
    mimetype.startsWith('image/') ||
    mimetype.startsWith('application/vnd.openxmlformats-officedocument.');

  if (!allowedMime || !matchesMagicBytes(mimetype, file.originalname, file.buffer)) {
    throw new UnprocessableEntityException('File type or content is not allowed');
  }
}
