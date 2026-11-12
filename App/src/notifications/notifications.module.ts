import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushService } from './push.service';
import { NotificationSchedulerService } from './notification-scheduler.service';

@Module({
  providers: [NotificationsService, PushService, NotificationSchedulerService],
  controllers: [NotificationsController],
  exports: [NotificationsService, PushService, NotificationSchedulerService],
})
export class NotificationsModule {}
