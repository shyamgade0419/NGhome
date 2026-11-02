import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappSettingsStore } from './whatsapp-settings.store';
import { WhatsappConnectionService } from './whatsapp-connection.service';
import { WhatsappCloudService } from './whatsapp-cloud.service';

@Module({
  providers: [WhatsappService, WhatsappSettingsStore, WhatsappConnectionService, WhatsappCloudService],
  controllers: [WhatsappController],
  exports: [WhatsappService, WhatsappSettingsStore, WhatsappConnectionService, WhatsappCloudService],
})
export class WhatsappModule {}
