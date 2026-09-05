import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { SftpStorageService } from './sftp-storage.service';

@Module({
  providers: [DocumentsService, SftpStorageService],
  controllers: [DocumentsController],
  // SftpStorageService is also used directly by PaymentsService, to attach
  // a payment's proof screenshot/receipt — that isn't a generic Document
  // browsable via this module's own endpoints (see PaymentsService.submit).
  exports: [DocumentsService, SftpStorageService],
})
export class DocumentsModule {}
