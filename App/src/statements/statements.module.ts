import { Module } from '@nestjs/common';
import { StatementsService } from './statements.service';
import { StatementsController } from './statements.controller';

@Module({
  providers: [StatementsService],
  controllers: [StatementsController],
  exports: [StatementsService],
})
export class StatementsModule {}
