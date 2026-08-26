import { Module } from '@nestjs/common';
import { SocietiesService } from './societies.service';
import { SocietiesController } from './societies.controller';

@Module({
  providers: [SocietiesService],
  controllers: [SocietiesController],
  exports: [SocietiesService],
})
export class SocietiesModule {}
