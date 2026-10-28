import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformMailService } from './platform-mail.service';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { SupportController } from './support.controller';

@Module({
  // DocumentsModule exports the one SftpStorageService instance — the same
  // connection settings the uploads use. AuthModule exports AuthService, so
  // inviteAdmin() reuses the exact same "set your password" link forgotten-
  // password uses, instead of building a parallel token/email path.
  // UsersModule exports UserDeleteService: the platform console and a society
  // admin erase accounts with the same code, differing only in how far they may reach.
  imports: [DocumentsModule, AuthModule, MailModule, UsersModule],
  controllers: [PlatformController, SupportController],
  providers: [PlatformService, PlatformMailService],
})
export class PlatformModule {}
