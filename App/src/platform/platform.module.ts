import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  // DocumentsModule exports the one SftpStorageService instance — the same
  // connection settings the uploads use.
  imports: [DocumentsModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
