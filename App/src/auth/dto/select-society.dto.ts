import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SelectSocietyDto {
  @ApiProperty({ description: 'Society ID to activate for this session' })
  @IsString()
  @IsNotEmpty()
  societyId: string;
}
