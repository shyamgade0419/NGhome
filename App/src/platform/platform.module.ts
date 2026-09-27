import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { SupportController } from './support.controller';

@Module({
  // DocumentsModule exports the one SftpStorageService instance — the same
  // connection settings the uploads use.
  imports: [DocumentsModule],
  controllers: [PlatformController, SupportController],
  providers: [PlatformService],
})
export class PlatformModule {}
