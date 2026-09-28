import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { SupportController } from './support.controller';

@Module({
  // DocumentsModule exports the one SftpStorageService instance — the same
  // connection settings the uploads use. AuthModule exports AuthService, so
  // inviteAdmin() reuses the exact same "set your password" link forgotten-
  // password uses, instead of building a parallel token/email path.
  imports: [DocumentsModule, AuthModule],
  controllers: [PlatformController, SupportController],
  providers: [PlatformService],
})
export class PlatformModule {}
