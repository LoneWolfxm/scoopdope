import { Injectable, NotFoundException, ForbiddenException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './notification.entity';
import { PushSubscription } from './push-subscription.entity';
import { NotificationsGateway } from './notifications.gateway';
import { User, UserRole } from '../users/user.entity';
import { PushNotificationsService } from './push-notifications.service';

const NOTIFICATION_CENTER_LIMIT = 20;
const EMAIL_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const EMAIL_IDEMPOTENCY_PREFIX = 'notifications:email:sent:';

export interface NotificationPreferences {
  pushEnabled: boolean;
  emailEnabled: boolean;
  courseUpdates: boolean;
  tokenRewards: boolean;
  qaActivity: boolean;
  announcements: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  emailEnabled: true,
  courseUpdates: true,
  tokenRewards: true,
  qaActivity: true,
  announcements: true,
};

export interface PaginatedNotifications {
  data: Notification[];
  total: number;
  page: number;
  limit: number;
  unreadCount: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private repo: Repository<Notification>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @Inject(forwardRef(() => NotificationsGateway))
    private gateway: NotificationsGateway,
    private pushNotificationsService: PushNotificationsService,
  ) {}

  /**
   * Returns the user's notification preferences, falling back to defaults
   * for any channel/type the user has not explicitly configured.
   */
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const stored = (user as any).notificationPreferences ?? {};
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...stored };
  }

  /**
   * Merges the provided preference toggles into the user's stored
   * notification preferences and persists them.
   */
  async updatePreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const current = (user as any).notificationPreferences ?? {};
    const merged: NotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...current,
      ...preferences,
    };
    (user as any).notificationPreferences = merged;

    await this.userRepo.save(user);
    return merged;
  }

  async create(
    userId: string,
    type: NotificationType,
    message: string,
    title?: string,
  ): Promise<Notification> {
    const notification = this.repo.create({
      userId,
      type,
      message,
      title: title ?? null,
      createdAt: new Date(),
    });
    const saved = await this.repo.save(notification);
    this.gateway.emitToUser(userId, 'notification', saved);

    // Send push notification if enabled
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (user && (user as any).notificationPreferences?.pushEnabled) {
      let shouldSendPush = false;
      const prefs = (user as any).notificationPreferences;

      switch (type) {
        case NotificationType.ENROLLMENT:
        case NotificationType.COMPLETION:
        case NotificationType.COURSE_PUBLISHED:
        case NotificationType.UPDATE:
          shouldSendPush = prefs.courseUpdates;
          break;
        case NotificationType.CREDENTIAL_ISSUED:
        case NotificationType.CERTIFICATE:
          shouldSendPush = prefs.tokenRewards;
          break;
        case NotificationType.QA_QUESTION:
        case NotificationType.QA_ANSWER:
          shouldSendPush = prefs.qaActivity;
          break;
        case NotificationType.ANNOUNCEMENT:
          shouldSendPush = prefs.announcements;
          break;
      }

      if (shouldSendPush) {
        await this.pushNotificationsService.sendNotification(userId, {
          title: title ?? 'ScoopDope',
          body: message,
          icon: '/icons/icon-192x192.png',
          url: '/notifications',
        });
      }
    }

    return saved;
  }

  /**
   * Create a system-wide notification for all users or a specific user.
   * Intended to be called by admins via the POST /notifications endpoint.
   */
  async createSystemNotification(
    adminUserId: string,
    payload: {
      userId?: string;
      type: NotificationType;
      title: string;
      message: string;
    },
  ): Promise<Notification | Notification[]> {
    // Validate the requesting user is an admin
    const admin = await this.userRepo.findOne({ where: { id: adminUserId } });
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can create system notifications');
    }

    if (payload.userId) {
      // Targeted notification
      return this.create(payload.userId, payload.type, payload.message, payload.title);
    }

    // Broadcast to all non-banned users in batches
    const batchSize = 200;
    let offset = 0;
    const results: Notification[] = [];

    while (true) {
      const users = await this.userRepo.find({
        where: { ...(({ isBanned: false } as any)) },
        select: ['id'],
        skip: offset,
        take: batchSize,
      });

      if (users.length === 0) break;

      const createdAt = new Date();
      const notifications = this.repo.create(
        users.map((u) => ({
          userId: u.id,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          createdAt,
        })),
      );
      const saved = await this.repo.save(notifications);
      results.push(...saved);

      // Emit via WebSocket to online users
      for (const n of saved) {
        this.gateway.emitToUser(n.userId, 'notification', n);
      }

      offset += batchSize;
      if (users.length < batchSize) break;
    }

    return results;
  }

  /**
   * Notify all enrolled students in a course using a single bulk insert
   * instead of N individual inserts.
   */
  async notifyCourseStudents(
    userIds: string[],
    type: NotificationType,
    message: string,
    title?: string,
  ): Promise<Notification[]> {
    if (userIds.length === 0) return [];

    const createdAt = new Date();
    const notifications = this.repo.create(
      userIds.map((userId) => ({
        userId,
        type,
        message,
        title: title ?? null,
        createdAt,
      })),
    );
    const saved = await this.repo.save(notifications);

    // Emit via WebSocket to online users
    for (const n of saved) {
      this.gateway.emitToUser(n.userId, 'notification', n);
    }

    return saved;
  }

  /**
   * Returns paginated notifications for a user.
   * Defaults to the last 20 (notification center view); supports full history via page.
   */
  async findByUser(
    userId: string,
    page = 1,
    limit = NOTIFICATION_CENTER_LIMIT,
  ): Promise<PaginatedNotifications> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const offset = (safePage - 1) * safeLimit;

    const [data, total] = await this.repo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: safeLimit,
    });

    const unreadCount = await this.repo.count({ where: { userId, isRead: false } });

    return { data, total, page: safePage, limit: safeLimit, unreadCount };
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.repo.count({ where: { userId, isRead: false } });
    return { count };
  }

  async markAsRead(id: string, userId: string): Promise<Notification> {
    const notification = await this.repo.findOne({ where: { id } });
    if (!notification) throw ne

/* … truncated 1152 chars — edit only what you need near the top … */
