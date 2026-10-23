import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AmenitiesController, AmenityBookingsController } from './amenities.controller';
import { AmenitiesService } from './amenities.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AmenitiesController, AmenityBookingsController],
  providers: [AmenitiesService],
})
export class AmenitiesModule {}
