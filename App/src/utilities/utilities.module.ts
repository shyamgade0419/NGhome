import { Module } from '@nestjs/common';
import { UtilitiesService } from './utilities.service';
import { UtilitiesController } from './utilities.controller';

@Module({
  providers: [UtilitiesService],
  controllers: [UtilitiesController],
  exports: [UtilitiesService],
})
export class UtilitiesModule {}
