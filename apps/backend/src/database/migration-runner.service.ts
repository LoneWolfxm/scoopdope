import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface MigrationStatus {
  id: number;
  timestamp: number;
  name: string;
  executedAt?: Date;
}

export interface MigrationResult {
  success: boolean;
  migrations: MigrationStatus[];
  executed: string[];
  durationMs: number;
}

const MIGRATION_ADVISORY_LOCK_KEY = 1234;
const LOCK_RETRY_INTERVAL_MS = 500;
const LOCK_MAX_WAIT_MS = 60_000;

@Injectable()
export class MigrationRunnerService {
  private readonly logger = new Logger(MigrationRunnerService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async run(): Promise<MigrationResult> {
    const start = Date.now();
    this.logger.log('Running pending migrations...');

    if (!this.dataSource.isInitialized) {
      throw new Error('DataSource is not initialized');
    }

    const acquired = await this.acquireAdvisoryLock();

    if (!acquired) {
      // Another instance holds the lock and is running migrations. Wait for it
      // to finish, then re-check whether migrations are already complete.
      this.logger.log(
        'Migration advisory lock held by another instance; waiting for completion...',
      );

      const completed = await this.waitForMigrationsComplete();

      if (!completed) {
        this.logger.warn(
          'Timed out waiting for concurrent migrations to complete; skipping migration run',
        );
      }

      const allMigrations = await this.getStatus();

      return {
        success: false,
        migrations: allMigrations,
        executed: [],
        durationMs: Date.now() - start,
      };
    }

    try {
      const executed = await this.dataSource.runMigrations();
      const durationMs = Date.now() - start;

      this.logger.log(
        `Ran ${executed.length} migration(s) in ${durationMs}ms`,
      );

      const allMigrations = await this.getStatus();

      return {
        success: executed.length > 0,
        migrations: allMigrations,
        executed: executed.map((m) => m.name),
        durationMs,
      };
    } finally {
      await this.releaseAdvisoryLock();
    }
  }

  async revert(): Promise<MigrationResult> {
    const start = Date.now();
    this.logger.log('Reverting last migration...');

    if (!this.dataSource.isInitialized) {
      throw new Error('DataSource is not initialized');
    }

    const acquired = await this.acquireAdvisoryLock();

    if (!acquired) {
      throw new Error(
        'Could not acquire migration advisory lock; another migration is in progress',
      );
    }

    try {
      const before = await this.getStatus();
      const executedBefore = before.filter((m) => m.executedAt).length;

      await this.dataSource.undoLastMigration();

      const after = await this.getStatus();
      const executedAfter = after.filter((m) => m.executedAt).length;
      const durationMs = Date.now() - start;

      const revertedCount = executedBefore - executedAfter;

      this.logger.log(
        `Reverted ${revertedCount} migration(s) in ${durationMs}ms`,
      );

      return {
        success: revertedCount > 0,
        migrations: after,
        executed: [],
        durationMs,
      };
    } finally {
      await this.releaseAdvisoryLock();
    }
  }

  private async acquireAdvisoryLock(): Promise<boolean> {
    const result = await this.dataSource.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [MIGRATION_ADVISORY_LOCK_KEY],
    );

    return Boolean(result?.[0]?.acquired);
  }

  private async releaseAdvisoryLock(): Promise<void> {
    try {
      await this.dataSource.query('SELECT pg_advisory_unlock($1)', [
        MIGRATION_ADVISORY_LOCK_KEY,
      ]);
    } catch (error) {
      this.logger.error(
        `Failed to release migration advisory lock: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async waitForMigrationsComplete(): Promise<boolean> {
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;

    while (Date.now() < deadline) {
      await this.sleep(LOCK_RETRY_INTERVAL_MS);

      const acquired = await this.acquireAdvisoryLock();

      if (acquired) {
        // Lock-holder finished; release immediately and report completion.
        await this.releaseAdvisoryLock();
        return true;
      }
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getStatus(): Promise<MigrationStatus[]> {
    if (!this.dataSource.isInitialized) {
      return [];
    }

    const executedMigrations = await this.dataSource.query(
      `SELECT id, name, "timestamp", "executedAt" FROM "${this.dataSource.options.migrationsTableName || 'migrations'}" ORDER BY "timestamp" ASC`,
    );

    const pendingMigrations =
      this.dataSource.migrations.filter(
        (m) =>
          !executedMigrations.some(
            (em: any) => em.name === m.name,
          ),
      );

    const all: MigrationStatus[] = [
      ...executedMigrations.map((em: any) => ({
        id: em.id,
        timestamp: em.timestamp,
        name: em.name,
        executedAt: em.executedAt ? new Date(em.executedAt) : undefined,
        status: 'executed' as const,
      })),
      ...pendingMigrations.map((pm) => ({
        id: -1,
        timestamp: this.extractTimestamp(pm.name ?? ''),
        name: pm.name ?? 'unknown',
        status: 'pending' as const,
      })),
    ];

    const seen = new Set<string>();
    const deduped = all.filter((m) => {
      if (seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });

    deduped.sort((a, b) => a.timestamp - b.timestamp);

    return deduped;
  }

  private extractTimestamp(name: string): number {
    const match = name.match(/(\d{13})/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
