import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAuditLogIpAddress1756400000000 implements MigrationInterface {
  name = 'AddAuditLogIpAddress1756400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'audit_logs',
      new TableColumn({
        name: 'ipAddress',
        type: 'varchar',
        length: '45',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('audit_logs', 'ipAddress');
  }
}