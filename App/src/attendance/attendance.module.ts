import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { GateStaffController, StaffAttendanceController, StaffRosterController, StaffShiftsController } from './attendance.controller';

@Module({
  controllers: [StaffShiftsController, StaffRosterController, StaffAttendanceController, GateStaffController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
