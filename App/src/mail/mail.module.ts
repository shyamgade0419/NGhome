import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailSettingsStore } from './mail-settings.store';

@Module({
  providers: [MailService, MailSettingsStore],
  exports: [MailService, MailSettingsStore],
})
export class MailModule {}
