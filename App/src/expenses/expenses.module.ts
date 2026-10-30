import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  // Receipts are stored through the same SFTP-backed storage every other upload uses.
  imports: [DocumentsModule],
  providers: [ExpensesService],
  controllers: [ExpensesController],
  exports: [ExpensesService],
})
export class ExpensesModule {}
