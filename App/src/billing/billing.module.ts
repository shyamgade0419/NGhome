import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { LateFeeService } from './late-fee.service';
import { BillingCalculatorService } from './billing-calculator.service';
import { BillingRulesModule } from '../billing-rules/billing-rules.module';

@Module({
  imports: [NotificationsModule, BillingRulesModule],
  providers: [BillingService, BillingCalculatorService, LateFeeService],
  controllers: [BillingController],
  exports: [BillingService, BillingCalculatorService, LateFeeService],
})
export class BillingModule {}
