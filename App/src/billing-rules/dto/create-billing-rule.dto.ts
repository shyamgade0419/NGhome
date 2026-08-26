import {
  IsString, IsOptional, IsEnum, IsBoolean, IsInt, IsDateString, IsArray,
  ValidateNested, IsNumber, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CalculationType } from '@prisma/client';

export class BillingRuleComponentDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsString()
  componentType: string;

  @ApiProperty({ enum: CalculationType })
  @IsEnum(CalculationType)
  calculationType: CalculationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  rate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  config?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  order?: number;
}

export class CreateBillingRuleDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: CalculationType })
  @IsEnum(CalculationType)
  calculationType: CalculationType;

  @ApiProperty()
  @IsDateString()
  effectiveFrom: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  config?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  applicableTo?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [BillingRuleComponentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BillingRuleComponentDto)
  components?: BillingRuleComponentDto[];
}
