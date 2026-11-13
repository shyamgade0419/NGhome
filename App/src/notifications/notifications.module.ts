import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushService } from './push.service';
import { NotificationSchedulerService } from './notification-scheduler.service';

@Module({
  imports: [WhatsappModule],
  providers: [NotificationsService, PushService, NotificationSchedulerService],
  controllers: [NotificationsController],
  exports: [NotificationsService, PushService, NotificationSchedulerService],
})
export class NotificationsModule {}
