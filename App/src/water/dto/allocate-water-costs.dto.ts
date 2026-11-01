import {
  IsString, IsOptional, IsDateString, IsNumber, IsEnum, IsPositive, Min, Max, IsArray, ArrayMinSize, ValidateNested,
} from 'class-validator';
import { EXCESS_MODES, type ExcessMode } from '../water-usage-limit';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FlatReadingInputDto {
  @ApiProperty()
  @IsString()
  flatId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  openingReading: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  closingReading: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * A limit on what each flat uses at the normal rate: the units above it are charged more. The service
 * re-checks the numbers (water-usage-limit.ts), so the ranges here are only the first gate.
 */
export class UsageLimitDto {
  /** Units a flat may use at the normal rate (units are KL on these meters). */
  @ApiProperty({ example: 20 })
  @IsNumber()
  @IsPositive()
  @Max(100_000)
  limitUnits: number;

  /** PERCENT: this % more per unit above the limit. PER_UNIT: this many rupees more per unit above it. ONE_TIME: this fee once. */
  @ApiProperty({ enum: EXCESS_MODES })
  @IsEnum(EXCESS_MODES)
  mode: ExcessMode;

  @ApiProperty({ example: 25 })
  @IsNumber()
  @Min(0)
  value: number;
}

/**
 * What the route accepts. The period is in the URL (`periods/:periodId/allocate`), and neither app
 * sends it again in the body — requiring it here made every allocation fail with "billingPeriodId
 * must be a string" from the day this became a validated class until now.
 */
export class AllocateWaterCostsBodyDto {
  @ApiProperty()
  @IsDateString()
  readingDate: string;

  /** Municipal water board bill for the month */
  @ApiProperty()
  @IsNumber()
  @Min(0)
  municipalWaterBill: number;

  /** Tanker water charges for the month */
  @ApiProperty()
  @IsNumber()
  @Min(0)
  tankerCost: number;

  /** Total common electricity bill (all usage) */
  @ApiProperty()
  @IsNumber()
  @Min(0)
  commonElectricityBill: number;

  /** Percentage (0–100) of common electricity attributed to water motor/pump */
  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  electricityWaterPercent: number;

  /**
   * The usage limit to apply. Leave it out to use the one already saved; send an object to apply and save
   * a new one; send null to switch the limit off. It is kept with the society's water rules, so it carries
   * over to the next month.
   */
  @ApiPropertyOptional({ type: UsageLimitDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => UsageLimitDto)
  usageLimit?: UsageLimitDto | null;

  /** Per-flat readings */
  @ApiProperty({ type: [FlatReadingInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlatReadingInputDto)
  readings: FlatReadingInputDto[];
}

/** The body plus the period taken from the URL — what the service works with. Not validated: it is built, not received. */
export class AllocateWaterCostsDto extends AllocateWaterCostsBodyDto {
  billingPeriodId: string;
}
