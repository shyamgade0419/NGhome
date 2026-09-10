import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { SftpStorageService } from './sftp-storage.service';
import { StoragePathService } from './storage-path.service';

@Module({
  providers: [DocumentsService, SftpStorageService, StoragePathService],
  controllers: [DocumentsController],
  // SftpStorageService is also used directly by PaymentsService, to attach
  // a payment's proof screenshot/receipt — that isn't a generic Document
  // browsable via this module's own endpoints (see PaymentsService.submit).
  // StoragePathService goes with it: every upload, in any module, gets its
  // SFTP path from that one place.
  exports: [DocumentsService, SftpStorageService, StoragePathService],
})
export class DocumentsModule {}
