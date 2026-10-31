import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { LateFeeService } from './late-fee.service';
import { BillingCalculatorService } from './billing-calculator.service';
import { BillingRulesModule } from '../billing-rules/billing-rules.module';
import { OpeningBalancesService } from './opening-balances.service';
import { OpeningBalancesController } from './opening-balances.controller';

@Module({
  imports: [NotificationsModule, BillingRulesModule],
  providers: [BillingService, BillingCalculatorService, LateFeeService, OpeningBalancesService],
  controllers: [BillingController, OpeningBalancesController],
  exports: [BillingService, BillingCalculatorService, LateFeeService],
})
export class BillingModule {}
