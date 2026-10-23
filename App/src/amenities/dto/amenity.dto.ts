import {
  IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AmenityBookingMode } from '@prisma/client';

/**
 * Classes, not interfaces, so the global ValidationPipe actually runs — see
 * CreateEventDto for what happens when it doesn't. Cross-field rules (closing
 * after opening, at least one slot fitting in the day) are checked in the
 * service, where both values are known.
 */
export class CreateAmenityDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'House rules shown before a resident confirms a booking.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rules?: string;

  @ApiPropertyOptional({ enum: AmenityBookingMode })
  @IsOptional()
  @IsEnum(AmenityBookingMode)
  bookingMode?: AmenityBookingMode;

  @ApiPropertyOptional({ description: 'Length of one slot, in minutes.' })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(480)
  slotMinutes?: number;

  @ApiPropertyOptional({ description: 'Opening time, minutes since midnight IST (06:00 = 360).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  opensAtMin?: number;

  @ApiPropertyOptional({ description: 'Closing time, minutes since midnight IST (22:00 = 1320).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  closesAtMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  maxAdvanceDays?: number;

  @ApiPropertyOptional({ description: 'Most bookings one flat may hold in a calendar month. Omit for no limit.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  monthlyCapPerFlat?: number;

  @ApiPropertyOptional({ description: 'A resident may cancel this many hours before the start. Committee may always cancel.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  cancelBeforeHours?: number;

  @ApiPropertyOptional({ description: 'How many bookings may overlap one slot. 1 means exclusive use.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;

  @ApiPropertyOptional({ description: 'How many consecutive slots one booking may cover.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  maxSlotsPerBooking?: number;

  @ApiPropertyOptional({ description: 'Fee per booking in rupees. Omit or 0 for free.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  fee?: number;
}

export class UpdateAmenityDto extends PartialType(CreateAmenityDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
