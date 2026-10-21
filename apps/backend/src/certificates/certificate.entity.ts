import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Course } from '../courses/course.entity';
import { LearningPath } from '../learning-paths/learning-path.entity';

@Entity('certificates')
@Unique(['userId', 'courseId'])
@Index(['userId', 'learningPathId'], {
  unique: true,
  where: `"learningPathId" IS NOT NULL`,
})
export class Certificate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  // Why: certificates belong to a user; deleting the user removes them (consider SET NULL to preserve on-chain Stellar records).
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  // Why: course certificates reference a course; path certificates leave this null.
  @Column({ nullable: true })
  courseId!: string | null;

  // Why: if a course is deleted, its issued certificates are removed (consider SET NULL to preserve verifiable credential history).
  @ManyToOne(() => Course, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'courseId' })
  course!: Course | null;

  // Why: learning-path certificates reference a learning path; course certificates leave this null.
  @Column({ nullable: true })
  learningPathId!: string | null;

  // Why: if a learning path is deleted, its issued certificates are removed (consider SET NULL to preserve verifiable credential history).
  @ManyToOne(() => LearningPath, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'learningPathId' })
  learningPath!: LearningPath | null;

  // Why: distinguishes course-level credentials from higher-level learning-path credentials.
  @Column({ default: 'course' })
  certificateType!: 'course' | 'learning_path';

  @Column()
  certificateHash!: string;

  @Column({ nullable: true })
  ipfsHash!: string;

  @Column({ nullable: true })
  stellarTransactionId!: string;

  @Column({ default: 'pending' })
  status!: 'pending' | 'minted' | 'verified';

  @Column({ nullable: true })
  pdfUrl!: string;

  @Column({ nullable: true, type: 'timestamptz' })
  revokedAt: Date | null;

  @CreateDateColumn()
  issuedAt!: Date;
}