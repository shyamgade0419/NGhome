import {
  IsString, IsOptional, IsDateString, IsNumber, Min, Max, IsArray, ArrayMinSize, ValidateNested,
} from 'class-validator';
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

export class AllocateWaterCostsDto {
  @ApiProperty()
  @IsString()
  billingPeriodId: string;

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

  /** Per-flat readings */
  @ApiProperty({ type: [FlatReadingInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlatReadingInputDto)
  readings: FlatReadingInputDto[];
}
