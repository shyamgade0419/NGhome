import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceStatus } from '@prisma/client';
import { Trim } from '../../common/decorators/trim.decorator';
import { ATTENDANCE_LIMITS } from '../attendance-rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateShiftDto {
  @ApiProperty({ example: 'Morning' }) @Trim() @IsString() @MinLength(2) @MaxLength(40)
  name: string;

  @ApiProperty({ example: '06:00', description: 'India time, 24-hour' }) @Matches(TIME, { message: 'startTime must be a time like 06:00' })
  startTime: string;

  @ApiProperty({ example: '14:00', description: 'Before the start means the shift runs past midnight.' }) @Matches(TIME, { message: 'endTime must be a time like 14:00' })
  endTime: string;
}

export class UpdateShiftDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(2) @MaxLength(40)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @Matches(TIME, { message: 'startTime must be a time like 06:00' })
  startTime?: string;

  @ApiPropertyOptional() @IsOptional() @Matches(TIME, { message: 'endTime must be a time like 14:00' })
  endTime?: string;

  @ApiPropertyOptional({ description: 'false retires a shift: it stays in history but cannot be assigned.' }) @IsOptional() @IsBoolean()
  active?: boolean;
}

/** Put people on a shift (or a day off) for a range of dates. */
export class AssignRosterDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsUUID('all', { each: true })
  employeeIds: string[];

  @ApiProperty({ example: '2026-11-02' }) @Matches(DATE, { message: 'from must be a date like 2026-11-02' })
  from: string;

  @ApiProperty({ example: '2026-11-08' }) @Matches(DATE, { message: 'to must be a date like 2026-11-08' })
  to: string;

  @ApiPropertyOptional({ nullable: true, description: 'Omit or null for a scheduled day off.' }) @IsOptional() @IsUUID()
  shiftId?: string | null;

  @ApiPropertyOptional({ description: 'Where, e.g. Main gate.' }) @IsOptional() @Trim() @IsString() @MaxLength(60)
  post?: string;

  @ApiPropertyOptional({ type: [Number], description: 'Only these days of the week (0 Sunday to 6 Saturday). Default: every day.' })
  @IsOptional() @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  weekdays?: number[];
}

export class ClearRosterDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsUUID('all', { each: true })
  employeeIds: string[];

  @ApiProperty() @Matches(DATE, { message: 'from must be a date like 2026-11-02' })
  from: string;

  @ApiProperty() @Matches(DATE, { message: 'to must be a date like 2026-11-08' })
  to: string;
}

/** The committee records or corrects one person's day. */
export class MarkAttendanceDto {
  @ApiProperty() @IsUUID()
  employeeId: string;

  @ApiProperty({ example: '2026-10-30' }) @Matches(DATE, { message: 'date must be a date like 2026-10-30' })
  date: string;

  @ApiProperty({ enum: AttendanceStatus }) @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @ApiPropertyOptional({ example: '06:05', description: 'Only for present and half day.' }) @IsOptional() @Matches(TIME, { message: 'checkIn must be a time like 06:05' })
  checkIn?: string;

  @ApiPropertyOptional({ example: '14:10', description: 'Only for present and half day. Earlier than the check-in means the next day.' }) @IsOptional() @Matches(TIME, { message: 'checkOut must be a time like 14:10' })
  checkOut?: string;

  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(200)
  note?: string;
}

export class DayEntryDto {
  @ApiProperty() @IsUUID()
  employeeId: string;

  @ApiProperty({ enum: AttendanceStatus }) @IsEnum(AttendanceStatus)
  status: AttendanceStatus;
}

/** Mark the whole day at once, e.g. everyone present. Times already recorded at the gate are kept. */
export class MarkDayDto {
  @ApiProperty() @Matches(DATE, { message: 'date must be a date like 2026-10-30' })
  date: string;

  @ApiProperty({ type: [DayEntryDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(ATTENDANCE_LIMITS.dayEntries) @ValidateNested({ each: true }) @Type(() => DayEntryDto)
  entries: DayEntryDto[];
}
