import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingCalculatorService } from './billing-calculator.service';
import { BillingRulesModule } from '../billing-rules/billing-rules.module';

@Module({
  imports: [BillingRulesModule],
  providers: [BillingService, BillingCalculatorService],
  controllers: [BillingController],
  exports: [BillingService, BillingCalculatorService],
})
export class BillingModule {}
