import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddProcessedWebhookEvents1756400000001 implements MigrationInterface {
  name = 'AddProcessedWebhookEvents1756400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'processed_webhook_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'event_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'processed_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'processed_webhook_events',
      new TableIndex({
        name: 'UQ_processed_webhook_events_event_id',
        columnNames: ['event_id'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'processed_webhook_events',
      new TableIndex({
        name: 'IDX_processed_webhook_events_processed_at',
        columnNames: ['processed_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('processed_webhook_events', true);
  }
}