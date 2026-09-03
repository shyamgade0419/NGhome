import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { SftpStorageService } from './sftp-storage.service';

@Module({
  providers: [DocumentsService, SftpStorageService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
