import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('notes')
@Index(['userId', 'lessonId'])
export class Note {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  lessonId: string;

  @Column('text')
  content: string;

  /** Video timestamp in seconds when the note was taken */
  @Column({ type: 'float', default: 0 })
  timestamp: number;

  /** Generated tsvector column used for full-text search */
  @Column({
    type: 'tsvector',
    generatedType: 'STORED',
    asExpression: "to_tsvector('english', coalesce(content, ''))",
    insert: false,
    update: false,
    select: false,
  })
  searchVector: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}