import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { LateFeeService } from './late-fee.service';
import { BillingCalculatorService } from './billing-calculator.service';
import { BillingRulesModule } from '../billing-rules/billing-rules.module';
import { OpeningBalancesService } from './opening-balances.service';
import { OpeningBalancesController } from './opening-balances.controller';
import { FlatDiscountsService } from './flat-discounts.service';
import { FlatDiscountsController } from './flat-discounts.controller';
import { AdvanceCreditsService } from './advance-credits.service';
import { AdvanceCreditsController } from './advance-credits.controller';

@Module({
  imports: [NotificationsModule, BillingRulesModule],
  providers: [BillingService, BillingCalculatorService, LateFeeService, OpeningBalancesService, FlatDiscountsService, AdvanceCreditsService],
  controllers: [BillingController, OpeningBalancesController, FlatDiscountsController, AdvanceCreditsController],
  exports: [BillingService, BillingCalculatorService, LateFeeService],
})
export class BillingModule {}
