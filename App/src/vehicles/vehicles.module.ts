import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { GateVehiclesController, ParkingController, ParkingSlotsController, VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [NotificationsModule],
  controllers: [VehiclesController, ParkingController, ParkingSlotsController, GateVehiclesController],
  providers: [VehiclesService],
})
export class VehiclesModule {}
