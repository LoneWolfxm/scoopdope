import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Req,
  Res,
  BadRequestException,
  NotFoundException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LessonsService } from './lessons.service';
import { CreateLessonDto } from './dto/create-lesson.dto';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Post()
  create(@Body() createLessonDto: CreateLessonDto) {
    const { videoUrl } = createLessonDto;

    if (videoUrl !== undefined && videoUrl !== null && videoUrl !== '') {
      if (typeof videoUrl !== 'string' || !this.isValidUrl(videoUrl)) {
        throw new BadRequestException('videoUrl must be a valid URL');
      }
    }

    return this.lessonsService.create(createLessonDto);
  }

  @Get(':id/video')
  async streamVideo(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.lessonsService.getVideoFile(id);

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    const { filePath, size, contentType } = video;
    const rangeHeader = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);

    if (!rangeHeader) {
      res.status(HttpStatus.OK);
      res.setHeader('Content-Length', size.toString());
      const stream = this.lessonsService.createVideoStream(filePath, 0, size - 1);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(HttpStatus.INTERNAL_SERVER_ERROR).end();
        } else {
          res.end();
        }
      });
      stream.pipe(res);
      return;
    }

    const range = this.lessonsService.parseRangeHeader(rangeHeader, size);

    if (!range) {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }

    const { start, end } = range;
    const chunkSize = end - start + 1;

    res.status(HttpStatus.PARTIAL_CONTENT);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', chunkSize.toString());

    const stream = this.lessonsService.createVideoStream(filePath, start, end);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).end();
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  }

  private isValidUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
}