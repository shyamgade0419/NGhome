import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeliveryExpectationsController, GateDeliveriesController, ParcelsController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';

@Module({
  imports: [NotificationsModule],
  controllers: [DeliveryExpectationsController, ParcelsController, GateDeliveriesController],
  providers: [DeliveriesService],
})
export class DeliveriesModule {}
