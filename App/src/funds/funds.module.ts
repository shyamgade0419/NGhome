import { Module } from '@nestjs/common';
import { FundsService } from './funds.service';
import { FundsController } from './funds.controller';
import { ResidencyService } from '../common/residency.service';

@Module({
  providers: [FundsService, ResidencyService],
  controllers: [FundsController],
  exports: [FundsService],
})
export class FundsModule {}
