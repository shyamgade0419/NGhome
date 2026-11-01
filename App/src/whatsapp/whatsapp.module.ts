import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappSettingsStore } from './whatsapp-settings.store';
import { WhatsappConnectionService } from './whatsapp-connection.service';

@Module({
  providers: [WhatsappService, WhatsappSettingsStore, WhatsappConnectionService],
  controllers: [WhatsappController],
  exports: [WhatsappService, WhatsappSettingsStore, WhatsappConnectionService],
})
export class WhatsappModule {}
