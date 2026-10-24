import { Module, forwardRef } from '@nestjs/common';
import { StellarService } from './stellar.service';
import { StellarController, CredentialsController, WalletController } from './stellar.controller';
import { NetworkMonitorService } from './network-monitor.service';
import { StellarIndexerService } from './stellar-indexer.service';
import { CredentialsModule } from '../credentials/credentials.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    forwardRef(() => CredentialsModule),
    NotificationsModule,
    forwardRef(() => UsersModule),
    MetricsModule,
  ],
  providers: [StellarService, NetworkMonitorService, StellarIndexerService],
  controllers: [StellarController, CredentialsController, WalletController],
  exports: [StellarService, NetworkMonitorService],
})
export class StellarModule {}
