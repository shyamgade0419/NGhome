import {
  IsString, IsOptional, IsNumber, IsInt, IsEnum, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FlatStatus } from '@prisma/client';

export class CreateFlatDto {
  @ApiProperty()
  @IsString()
  buildingId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  floorId?: string;

  @ApiProperty()
  @IsString()
  unitNumber: string;

  @ApiProperty({ description: 'Unique identifier like A-101' })
  @IsString()
  flatCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  area?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @ApiPropertyOptional({ description: '1BHK, 2BHK, COMMERCIAL, etc.' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: FlatStatus })
  @IsOptional()
  @IsEnum(FlatStatus)
  status?: FlatStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownershipType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  parkingSlots?: number;
}
