import { AppDataSource } from '../data-source';

const command = process.argv[2];

const MIGRATION_LOCK_ID = 1234;
const LOCK_POLL_INTERVAL_MS = 500;
const LOCK_MAX_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function tryAcquireLock(): Promise<boolean> {
  const result = await AppDataSource.query('SELECT pg_try_advisory_lock($1) AS locked', [
    MIGRATION_LOCK_ID,
  ]);
  return Boolean(result?.[0]?.locked);
}

async function releaseLock(): Promise<void> {
  try {
    await AppDataSource.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
  } catch (error) {
    console.error('Failed to release migration advisory lock:', error);
  }
}

async function hasPendingMigrations(): Promise<boolean> {
  const executedMigrations = await AppDataSource.query(
    `SELECT name FROM "${AppDataSource.options.migrationsTableName || 'migrations'}"`,
  );
  return AppDataSource.migrations.some(
    (m) => !executedMigrations.some((em: any) => em.name === m.name),
  );
}

/**
 * Acquire the distributed migration advisory lock, waiting briefly for a
 * concurrent instance to finish. Returns true if the lock was acquired.
 */
async function acquireLockWithWait(): Promise<boolean> {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (await tryAcquireLock()) {
      return true;
    }
    process.stdout.write('Another instance is running migrations, waiting...\n');
    await sleep(LOCK_POLL_INTERVAL_MS);
  }
  return false;
}

async function main() {
  if (!command || !['run', 'revert', 'show'].includes(command)) {
    console.error('Usage: node dist/database/migration-runner.js <run|revert|show>');
    process.exit(1);
  }

  try {
    await AppDataSource.initialize();

    switch (command) {
      case 'run': {
        const acquired = await acquireLockWithWait();
        if (!acquired) {
          const pending = await hasPendingMigrations();
          if (pending) {
            console.error('Could not acquire migration lock and migrations are still pending.');
            await AppDataSource.destroy();
            process.exit(1);
          }
          process.stdout.write('Migrations already applied by another instance.\n');
          break;
        }
        try {
          const migrations = await AppDataSource.runMigrations();
          if (migrations.length === 0) {
            process.stdout.write('No pending migrations to run.\n');
          } else {
            process.stdout.write(`Ran ${migrations.length} migration(s):\n`);
            migrations.forEach((m) => process.stdout.write(`  ✅ ${m.name}\n`));
          }
        } finally {
          await releaseLock();
        }
        break;
      }
      case 'revert': {
        const acquired = await acquireLockWithWait();
        if (!acquired) {
          console.error('Could not acquire migration lock to revert.');
          await AppDataSource.destroy();
          process.exit(1);
        }
        try {
          await AppDataSource.undoLastMigration();
          process.stdout.write('Reverted last migration.\n');
        } finally {
          await releaseLock();
        }
        break;
      }
      case 'show': {
        const executedMigrations = await AppDataSource.query(
          `SELECT name, "timestamp", "executedAt" FROM "${AppDataSource.options.migrationsTableName || 'migrations'}" ORDER BY "timestamp" ASC`,
        );
        const pendingMigrations = AppDataSource.migrations.filter(
          (m) => !executedMigrations.some((em: any) => em.name === m.name),
        );

        process.stdout.write('\nExecuted migrations:\n');
        if (executedMigrations.length === 0) {
          process.stdout.write('  (none)\n');
        } else {
          executedMigrations.forEach((em: any) =>
            process.stdout.write(`  ✅ ${em.name} (${em.executedAt})\n`),
          );
        }

        process.stdout.write('\nPending migrations:\n');
        if (pendingMigrations.length === 0) {
          process.stdout.write('  (none)\n');
        } else {
          pendingMigrations.forEach((pm) => process.stdout.write(`  ⏳ ${pm.name}\n`));
        }
        break;
      }
    }

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('Migration command failed:', error);
    process.exit(1);
  }
}

main();
