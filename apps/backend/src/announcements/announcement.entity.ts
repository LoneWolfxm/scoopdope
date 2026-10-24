import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Course } from '../courses/course.entity';

export type AnnouncementScope = 'course' | 'platform';

@Entity('announcements')
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Why: platform-wide announcements are not tied to a course, so courseId is nullable.
  @Column({ type: 'uuid', nullable: true })
  courseId: string | null;

  // Why: announcements are scoped to a course; removing the course removes its announcements.
  @ManyToOne(() => Course, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'courseId' })
  course: Course | null;

  @Column()
  instructorId: string;

  // Why: instructor deletion removes their announcements; consider SET NULL to preserve announcements for enrolled students.
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instructorId' })
  instructor: User;

  @Column()
  title: string;

  @Column('text')
  content: string;

  // Why: distinguishes course-scoped announcements (enrolled learners only) from
  // platform-wide admin announcements (all users) when resolving recipients.
  @Column({ type: 'varchar', default: 'course' })
  scope: AnnouncementScope;

  @CreateDateColumn()
  createdAt: Date;
}