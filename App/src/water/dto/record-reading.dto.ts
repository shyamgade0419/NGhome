import { IsString, IsOptional, IsDateString, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordReadingDto {
  @ApiProperty()
  @IsString()
  flatId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  waterConfigId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingPeriodId?: string;

  @ApiProperty()
  @IsDateString()
  readingDate: string;

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
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
