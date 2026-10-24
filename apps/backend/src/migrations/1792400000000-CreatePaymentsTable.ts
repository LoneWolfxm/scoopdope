import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class CreatePaymentsTable1792400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'payments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid', isNullable: false },
          { name: 'stripeSubscriptionId', type: 'varchar', isNullable: false },
          { name: 'stripePaymentIntentId', type: 'varchar', isNullable: false },
          { name: 'stripeRefundId', type: 'varchar', isNullable: false, isUnique: true },
          { name: 'amount', type: 'integer', isNullable: false },
          { name: 'currency', type: 'varchar', length: '3', isNullable: false },
          { name: 'transactionType', type: 'varchar', default: "'refund'", isNullable: false },
          { name: 'status', type: 'varchar', default: "'succeeded'", isNullable: false },
          { name: 'createdAt', type: 'timestamp', default: 'now()', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'payments',
      new TableIndex({ name: 'IDX_payments_stripeSubscriptionId', columnNames: ['stripeSubscriptionId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('payments', true);
  }
}

export class AddPayoutCurrencyAndExchangeRate1792500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('payouts', [
      new TableColumn({
        name: 'payoutCurrency',
        type: 'varchar',
        length: '3',
        default: "'USD'",
        isNullable: false,
      }),
      new TableColumn({
        name: 'exchangeRate',
        type: 'decimal',
        precision: 18,
        scale: 8,
        isNullable: true,
      }),
      new TableColumn({
        name: 'exchangeRateTimestamp',
        type: 'timestamptz',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('payouts', 'exchangeRateTimestamp');
    await queryRunner.dropColumn('payouts', 'exchangeRate');
    await queryRunner.dropColumn('payouts', 'payoutCurrency');
  }
}