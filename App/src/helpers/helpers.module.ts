import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { GateHelpersController, HelperVisitsController, HelpersController } from './helpers.controller';
import { HelpersService } from './helpers.service';

@Module({
  imports: [NotificationsModule],
  controllers: [HelpersController, HelperVisitsController, GateHelpersController],
  providers: [HelpersService],
})
export class HelpersModule {}
