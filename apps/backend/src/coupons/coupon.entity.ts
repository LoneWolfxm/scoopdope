import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Course } from '../courses/course.entity';

@Entity('coupons')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    unique: true,
    transformer: {
      to: (value: string) => (value ? value.toUpperCase() : value),
      from: (value: string) => value,
    },
  })
  code: string;

  @Column()
  discountType: 'percentage' | 'fixed';

  @Column('decimal', { precision: 10, scale: 2 })
  discountValue: number;

  @Column({ nullable: true, type: 'timestamp' })
  expiresAt: Date | null;

  @Column({ default: 0 })
  usageCount: number;

  @Column({ nullable: true })
  maxUsage: number | null;

  @Column({ default: true })
  isActive: boolean;

  @ManyToMany(() => Course, { eager: false })
  @JoinTable({ name: 'coupon_courses' })
  courses: Course[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeCode() {
    if (this.code) {
      this.code = this.code.toUpperCase();
    }
  }
}