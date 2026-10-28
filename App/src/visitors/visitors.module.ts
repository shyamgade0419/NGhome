import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { GateController, VisitorInvitationsController, VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';

@Module({
  imports: [NotificationsModule],
  controllers: [VisitorInvitationsController, VisitorsController, GateController],
  providers: [VisitorsService],
})
export class VisitorsModule {}
