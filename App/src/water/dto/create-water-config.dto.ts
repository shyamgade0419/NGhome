import { IsString, IsOptional, IsEnum, IsDateString, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WaterBillingModel } from '@prisma/client';

export class CreateWaterConfigDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: WaterBillingModel })
  @IsEnum(WaterBillingModel)
  billingModel: WaterBillingModel;

  @ApiProperty()
  @IsDateString()
  effectiveFrom: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiProperty()
  @IsObject()
  config: Record<string, unknown>;
}
