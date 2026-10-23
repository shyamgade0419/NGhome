import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBookingDto {
  @ApiProperty()
  @IsString()
  amenityId: string;

  @ApiProperty({ description: 'ISO start time of the first slot, as returned by the availability endpoint.' })
  @IsDateString()
  startAt: string;

  @ApiPropertyOptional({ description: 'Consecutive slots to book. Defaults to 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  slots?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  guestCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class RejectBookingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class CollectFeeDto {
  @ApiProperty({ description: 'The society account the fee was paid into.' })
  @IsString()
  accountId: string;
}
