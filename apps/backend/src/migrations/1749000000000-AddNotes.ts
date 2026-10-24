import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotes1749000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notes" (
        "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId"    uuid NOT NULL,
        "lessonId"  uuid NOT NULL,
        "content"   text NOT NULL,
        "timestamp" float NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_notes_user_lesson" ON "notes" ("userId", "lessonId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notes"`);
  }
}

export class AddNotesSearchVector1749000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notes"
      ADD COLUMN "searchVector" tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED
    `);
    await queryRunner.query(`CREATE INDEX "IDX_notes_search_vector" ON "notes" USING GIN ("searchVector")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notes_search_vector"`);
    await queryRunner.query(`ALTER TABLE "notes" DROP COLUMN IF EXISTS "searchVector"`);
  }
}