import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SlotFor, VehicleKind } from '@prisma/client';
import { Trim } from '../../common/decorators/trim.decorator';
import { VEHICLE_LIMITS } from '../vehicle-rules';

const PLATE = /^[A-Za-z0-9][A-Za-z0-9 .-]{2,18}[A-Za-z0-9]$/;

/** A resident registers a vehicle. The flat and society come from the sign-in. */
export class AddVehicleDto {
  @ApiProperty({ example: 'TS09 AB 1234' }) @Trim() @Matches(PLATE, { message: 'plate must be 4–12 letters and digits (spaces and dashes are fine)' })
  plate: string;

  @ApiProperty({ enum: VehicleKind }) @IsEnum(VehicleKind)
  kind: VehicleKind;

  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(60)
  make?: string;

  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(30)
  colour?: string;
}

/** A resident says which of their vehicles uses one of their slots; null clears it. */
export class AssignVehicleDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID()
  vehicleId?: string | null;
}

export class RemoveVehicleDto {
  @ApiPropertyOptional({ description: 'Why. Kept in the audit trail and shown to the household.' }) @IsOptional() @Trim() @IsString() @MinLength(3) @MaxLength(300)
  reason?: string;
}

export class CommitteeRemoveVehicleDto {
  @ApiProperty({ description: 'Why. Kept in the audit trail and shown to the household.' }) @Trim() @IsString() @MinLength(3) @MaxLength(300)
  reason: string;
}

export class CreateSlotDto {
  @ApiProperty({ example: 'B1-12' }) @Trim() @IsString() @MinLength(1) @MaxLength(20)
  code: string;

  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(60)
  area?: string;

  @ApiPropertyOptional({ enum: SlotFor }) @IsOptional() @IsEnum(SlotFor)
  slotFor?: SlotFor;

  @ApiPropertyOptional({ description: 'A visitor slot is never allocated to a flat.' }) @IsOptional() @IsBoolean()
  visitor?: boolean;
}

/** Many slots at once: prefix + a number for each from..to. */
export class BulkSlotsDto {
  @ApiPropertyOptional({ example: 'B1-' }) @IsOptional() @Trim() @IsString() @MaxLength(15)
  prefix?: string;

  @ApiProperty() @IsInt() @Min(0) @Max(9999)
  from: number;

  @ApiProperty({ description: `At most ${VEHICLE_LIMITS.bulkSlots} slots per request.` }) @IsInt() @Min(0) @Max(9999)
  to: number;

  @ApiPropertyOptional({ description: 'Pad numbers with zeros to this width, e.g. 2 gives 01, 02.' }) @IsOptional() @IsInt() @Min(0) @Max(4)
  pad?: number;

  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(60)
  area?: string;

  @ApiPropertyOptional({ enum: SlotFor }) @IsOptional() @IsEnum(SlotFor)
  slotFor?: SlotFor;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  visitor?: boolean;
}

export class AllocateSlotDto {
  @ApiProperty() @IsUUID()
  flatId: string;
}
