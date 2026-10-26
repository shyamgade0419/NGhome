import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignFlatDto {
  @ApiProperty({ description: 'The flat to attach to this member. Must belong to the same society.' })
  @IsString() @IsNotEmpty()
  flatId: string;
}
