import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetSocietyStatusDto {
  @ApiProperty({
    description:
      'false suspends the society, true reinstates it. Nothing is deleted either way — ' +
      'memberships, bills and history are untouched, so reinstating restores it as it was.',
  })
  @IsBoolean()
  isActive: boolean;
}
