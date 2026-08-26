import { Module } from '@nestjs/common';
import { FlatsService } from './flats.service';
import { FlatsController } from './flats.controller';

@Module({
  providers: [FlatsService],
  controllers: [FlatsController],
  exports: [FlatsService],
})
export class FlatsModule {}
