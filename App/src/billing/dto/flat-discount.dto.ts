import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FlatDiscountType } from '@prisma/client';

export class CreateFlatDiscountDto {
  @ApiProperty()
  @IsUUID()
  flatId: string;

  @ApiProperty({ enum: FlatDiscountType })
  @IsEnum(FlatDiscountType)
  type: FlatDiscountType;

  /** Rupees for FIXED, a percentage (up to 100) for PERCENT. */
  @ApiProperty({ example: 200 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  value: number;

  @ApiProperty({ example: 'Senior citizen concession' })
  @IsString()
  @MinLength(3, { message: 'Give a short reason for the discount' })
  @MaxLength(200)
  reason: string;

  /** The first day it is in force: a bill is discounted when its period starts on or after this. */
  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom: string;

  /** The last day it is in force. Leave out for no end. */
  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;
}

export class UpdateFlatDiscountDto {
  @ApiPropertyOptional({ enum: FlatDiscountType })
  @IsOptional()
  @IsEnum(FlatDiscountType)
  type?: FlatDiscountType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Give a short reason for the discount' })
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  /** null removes the end date. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
