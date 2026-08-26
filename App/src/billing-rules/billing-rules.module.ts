import { Module } from '@nestjs/common';
import { BillingRulesService } from './billing-rules.service';
import { BillingRulesController } from './billing-rules.controller';

@Module({
  providers: [BillingRulesService],
  controllers: [BillingRulesController],
  exports: [BillingRulesService],
})
export class BillingRulesModule {}
