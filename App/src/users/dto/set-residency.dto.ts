import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResidencyType } from '@prisma/client';

export class SetResidencyDto {
  @ApiProperty({ enum: ResidencyType })
  @IsEnum(ResidencyType, { message: 'residencyType must be OWNER or TENANT' })
  residencyType: ResidencyType;

  /** Only needed when the person is a member of more than one flat in this society. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  flatId?: string;
}
