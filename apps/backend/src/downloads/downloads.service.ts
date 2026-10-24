import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DownloadItem, DownloadStatus } from './download-item.entity';
import { Enrollment } from '../enrollments/enrollment.entity';

@Injectable()
export class DownloadsService {
  constructor(
    @InjectRepository(DownloadItem) private repo: Repository<DownloadItem>,
    @InjectRepository(Enrollment)
    private enrollmentRepo: Repository<Enrollment>,
  ) {}

  async assertCanDownload(
    userId: string,
    role: string,
    courseId: string,
  ): Promise<void> {
    if (role === 'admin' || role === 'instructor') {
      return;
    }
    const enrollment = await this.enrollmentRepo.findOne({
      where: { userId, courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException(
        'You must be enrolled in this course to download its materials',
      );
    }
  }

  async queueDownload(
    userId: string,
    role: string,
    courseId: string,
    lessonId?: string,
    lessonTitle?: string,
    fileUrl?: string,
    fileSizeBytes?: number,
  ): Promise<DownloadItem> {
    await this.assertCanDownload(userId, role, courseId);
    const item = this.repo.create({
      userId,
      courseId,
      lessonId,
      lessonTitle,
      fileUrl,
      fileSizeBytes: fileSizeBytes ?? 0,
      status: DownloadStatus.PENDING,
    });
    return this.repo.save(item);
  }

  async findByUser(userId: string): Promise<DownloadItem[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async markCompleted(id: string, userId: string): Promise<DownloadItem> {
    const item = await this.repo.findOne({ where: { id, userId } });
    if (!item) throw new NotFoundException('Download not found');
    item.status = DownloadStatus.COMPLETED;
    return this.repo.save(item);
  }

  async remove(id: string, userId: string): Promise<void> {
    const item = await this.repo.findOne({ where: { id, userId } });
    if (!item) throw new NotFoundException('Download not found');
    await this.repo.remove(item);
  }

  async getStorageStats(userId: string): Promise<{ totalBytes: number; count: number }> {
    const items = await this.repo.find({ where: { userId, status: DownloadStatus.COMPLETED } });
    const totalBytes = items.reduce((sum, i) => sum + Number(i.fileSizeBytes), 0);
    return { totalBytes, count: items.length };
  }
}
