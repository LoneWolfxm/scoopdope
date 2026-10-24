import {
  Injectable,
  BadRequestException,
  NotFoundException,
  RequestRangeNotSatisfiableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createReadStream, promises as fsPromises, Stats } from 'fs';
import { ReadStream } from 'fs';
import { Lesson } from './lesson.entity';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

export interface ParsedRange {
  start: number;
  end: number;
}

export interface VideoStreamResult {
  statusCode: 200 | 206;
  headers: {
    'Content-Type': string;
    'Content-Length': number;
    'Accept-Ranges': 'bytes';
    'Content-Range'?: string;
  };
  stream: ReadStream;
}

@Injectable()
export class LessonsService {
  constructor(
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
  ) {}

  async create(createLessonDto: CreateLessonDto): Promise<Lesson> {
    this.validateVideoUrl(createLessonDto.videoUrl);
    const lesson = this.lessonsRepository.create(createLessonDto);
    return this.lessonsRepository.save(lesson);
  }

  async update(id: string, updateLessonDto: UpdateLessonDto): Promise<Lesson> {
    if (updateLessonDto.videoUrl !== undefined) {
      this.validateVideoUrl(updateLessonDto.videoUrl);
    }
    await this.lessonsRepository.update(id, updateLessonDto);
    return this.findOne(id);
  }

  private validateVideoUrl(videoUrl?: string): void {
    if (videoUrl === undefined || videoUrl === null || videoUrl === '') {
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(videoUrl);
    } catch {
      throw new BadRequestException('videoUrl must be a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('videoUrl must be a valid URL');
    }
  }

  async findAll(): Promise<Lesson[]> {
    return this.lessonsRepository.find();
  }

  async findOne(id: string): Promise<Lesson> {
    return this.lessonsRepository.findOne({ where: { id } });
  }

  async remove(id: string): Promise<void> {
    await this.lessonsRepository.delete(id);
  }

  /**
   * Parse an HTTP Range header against a known resource size.
   *
   * Supported forms:
   *   - `bytes=start-end` (inclusive, clamped to size - 1)
   *   - `bytes=start-`    (from start to end of file)
   *   - `bytes=-suffix`   (last `suffix` bytes)
   *
   * Returns `null` when no Range header is supplied. Throws
   * `RequestRangeNotSatisfiableException` (416) for malformed or
   * unsatisfiable ranges.
   */
  parseRangeHeader(rangeHeader: string | undefined, size: number): ParsedRange | null {
    if (rangeHeader === undefined || rangeHeader === null || rangeHeader === '') {
      return null;
    }
    if (size <= 0) {
      throw new RequestRangeNotSatisfiableException();
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      throw new RequestRangeNotSatisfiableException();
    }

    const [, rawStart, rawEnd] = match;
    if (rawStart === '' && rawEnd === '') {
      throw new RequestRangeNotSatisfiableException();
    }

    let start: number;
    let end: number;

    if (rawStart === '') {
      // Suffix range: last N bytes.
      const suffixLength = Number(rawEnd);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        throw new RequestRangeNotSatisfiableException();
      }
      start = Math.max(size - suffixLength, 0);
      end = size - 1;
    } else {
      start = Number(rawStart);
      if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
        throw new RequestRangeNotSatisfiableException();
      }
      if (rawEnd === '') {
        end = size - 1;
      } else {
        end = Number(rawEnd);
        if (!Number.isSafeInteger(end) || end < start) {
          throw new RequestRangeNotSatisfiableException();
        }
        end = Math.min(end, size - 1);
      }
    }

    return { start, end };
  }

  /**
   * Resolve a video file into a streamable response, honouring the
   * optional HTTP Range header. Returns 206 with a partial stream for
   * range requests and 200 with the full stream otherwise.
   */
  async streamVideo(
    filePath: string,
    rangeHeader?: string,
    contentType = 'video/mp4',
  ): Promise<VideoStreamResult> {
    let stats: Stats;
    try {
      stats = await fsPromises.stat(filePath);
    } catch {
      throw new NotFoundException('Video file not found');
    }
    if (!stats.isFile()) {
      throw new NotFoundException('Video file not found');
    }

    const size = stats.size;
    const parsed = this.parseRangeHeader(rangeHeader, size);

    if (parsed === null) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': size,
          'Accept-Ranges': 'bytes',
        },
        stream: createReadStream(filePath),
      };
    }

    const { start, end } = parsed;
    return {
      statusCode: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
      },
      stream: createReadStream(filePath, { start, end }),
    };
  }
}
