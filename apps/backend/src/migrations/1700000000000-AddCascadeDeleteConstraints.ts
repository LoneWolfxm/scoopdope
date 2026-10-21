import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCascadeDeleteConstraints1700000000000 implements MigrationInterface {
  name = 'AddCascadeDeleteConstraints1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------------
    // 1. Clean up existing orphaned records
    // ---------------------------------------------------------------------

    // Orphaned course_modules (parent course no longer exists)
    await queryRunner.query(`
      DELETE FROM "course_modules"
      WHERE "courseId" IS NOT NULL
        AND "courseId" NOT IN (SELECT "id" FROM "courses")
    `);

    // Orphaned lessons (parent module no longer exists)
    await queryRunner.query(`
      DELETE FROM "lessons"
      WHERE "moduleId" IS NOT NULL
        AND "moduleId" NOT IN (SELECT "id" FROM "course_modules")
    `);

    // Orphaned enrollments (parent course or user no longer exists)
    await queryRunner.query(`
      DELETE FROM "enrollments"
      WHERE ("courseId" IS NOT NULL AND "courseId" NOT IN (SELECT "id" FROM "courses"))
         OR ("userId" IS NOT NULL AND "userId" NOT IN (SELECT "id" FROM "users"))
    `);

    // Orphaned reviews (parent course or user no longer exists)
    await queryRunner.query(`
      DELETE FROM "reviews"
      WHERE ("courseId" IS NOT NULL AND "courseId" NOT IN (SELECT "id" FROM "courses"))
         OR ("userId" IS NOT NULL AND "userId" NOT IN (SELECT "id" FROM "users"))
    `);

    // Orphaned course_prerequisites (parent course or prerequisite course no longer exists)
    await queryRunner.query(`
      DELETE FROM "course_prerequisites"
      WHERE ("courseId" IS NOT NULL AND "courseId" NOT IN (SELECT "id" FROM "courses"))
         OR ("prerequisiteId" IS NOT NULL AND "prerequisiteId" NOT IN (SELECT "id" FROM "courses"))
    `);

    // Orphaned assignments (parent module no longer exists)
    await queryRunner.query(`
      DELETE FROM "assignments"
      WHERE "moduleId" IS NOT NULL
        AND "moduleId" NOT IN (SELECT "id" FROM "course_modules")
    `);

    // ---------------------------------------------------------------------
    // 2. Drop and recreate foreign keys with ON DELETE CASCADE
    // ---------------------------------------------------------------------

    // course_modules -> courses
    await this.recreateForeignKey(queryRunner, {
      table: 'course_modules',
      column: 'courseId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_course_modules_course',
    });

    // lessons -> course_modules
    await this.recreateForeignKey(queryRunner, {
      table: 'lessons',
      column: 'moduleId',
      referencedTable: 'course_modules',
      referencedColumn: 'id',
      constraintName: 'FK_lessons_module',
    });

    // enrollments -> courses
    await this.recreateForeignKey(queryRunner, {
      table: 'enrollments',
      column: 'courseId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_enrollments_course',
    });

    // enrollments -> users
    await this.recreateForeignKey(queryRunner, {
      table: 'enrollments',
      column: 'userId',
      referencedTable: 'users',
      referencedColumn: 'id',
      constraintName: 'FK_enrollments_user',
    });

    // reviews -> courses
    await this.recreateForeignKey(queryRunner, {
      table: 'reviews',
      column: 'courseId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_reviews_course',
    });

    // reviews -> users
    await this.recreateForeignKey(queryRunner, {
      table: 'reviews',
      column: 'userId',
      referencedTable: 'users',
      referencedColumn: 'id',
      constraintName: 'FK_reviews_user',
    });

    // course_prerequisites -> courses (course)
    await this.recreateForeignKey(queryRunner, {
      table: 'course_prerequisites',
      column: 'courseId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_course_prerequisites_course',
    });

    // course_prerequisites -> courses (prerequisite)
    await this.recreateForeignKey(queryRunner, {
      table: 'course_prerequisites',
      column: 'prerequisiteId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_course_prerequisites_prerequisite',
    });

    // assignments -> course_modules
    await this.recreateForeignKey(queryRunner, {
      table: 'assignments',
      column: 'moduleId',
      referencedTable: 'course_modules',
      referencedColumn: 'id',
      constraintName: 'FK_assignments_module',
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore previous FK behaviour (no ON DELETE CASCADE)
    await this.recreateForeignKey(queryRunner, {
      table: 'course_modules',
      column: 'courseId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_course_modules_course',
      onDelete: 'NO ACTION',
    });

    await this.recreateForeignKey(queryRunner, {
      table: 'lessons',
      column: 'moduleId',
      referencedTable: 'course_modules',
      referencedColumn: 'id',
      constraintName: 'FK_lessons_module',
      onDelete: 'NO ACTION',
    });

    await this.recreateForeignKey(queryRunner, {
      table: 'enrollments',
      column: 'courseId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_enrollments_course',
      onDelete: 'NO ACTION',
    });

    await this.recreateForeignKey(queryRunner, {
      table: 'enrollments',
      column: 'userId',
      referencedTable: 'users',
      referencedColumn: 'id',
      constraintName: 'FK_enrollments_user',
      onDelete: 'NO ACTION',
    });

    await this.recreateForeignKey(queryRunner, {
      table: 'reviews',
      column: 'courseId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_reviews_course',
      onDelete: 'NO ACTION',
    });

    await this.recreateForeignKey(queryRunner, {
      table: 'reviews',
      column: 'userId',
      referencedTable: 'users',
      referencedColumn: 'id',
      constraintName: 'FK_reviews_user',
      onDelete: 'NO ACTION',
    });

    await this.recreateForeignKey(queryRunner, {
      table: 'course_prerequisites',
      column: 'courseId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_course_prerequisites_course',
      onDelete: 'NO ACTION',
    });

    await this.recreateForeignKey(queryRunner, {
      table: 'course_prerequisites',
      column: 'prerequisiteId',
      referencedTable: 'courses',
      referencedColumn: 'id',
      constraintName: 'FK_course_prerequisites_prerequisite',
      onDelete: 'NO ACTION',
    });

    await this.recreateForeignKey(queryRunner, {
      table: 'assignments',
      column: 'moduleId',
      referencedTable: 'course_modules',
      referencedColumn: 'id',
      constraintName: 'FK_assignments_module',
      onDelete: 'NO ACTION',
    });
  }

  /**
   * Drops any existing foreign key on the given column and recreates it with
   * the desired ON DELETE behaviour. Existing FK names are discovered via the
   * information schema so that we don't depend on TypeORM's generated names.
   */
  private async recreateForeignKey(
    queryRunner: QueryRunner,
    options: {
      table: string;
      column: string;
      referencedTable: string;
      referencedColumn: string;
      constraintName: string;
      onDelete?: 'CASCADE' | 'NO ACTION' | 'SET NULL' | 'RESTRICT';
    },
  ): Promise<void> {
    const {
      table,
      column,
      referencedTable,
      referencedColumn,
      constraintName,
      onDelete = 'CASCADE',
    } = options;

    // Discover existing FK constraint names on this column (Postgres).
    const existing: Array<{ constraint_name: string }> = await queryRunner.query(
      `
        SELECT tc.constraint_name AS constraint_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = $1
          AND kcu.column_name = $2
      `,
      [table, column],
    );

    for (const row of existing) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${row.constraint_name}"`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraintName}"`,
    );

    await queryRunner.query(
      `ALTER TABLE "${table}"
         ADD CONSTRAINT "${constraintName}"
         FOREIGN KEY ("${column}")
         REFERENCES "${referencedTable}" ("${referencedColumn}")
         ON DELETE ${onDelete}`,
    );
  }
}