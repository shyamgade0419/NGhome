import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BillNotesDto {
  @ApiProperty()
  @IsString()
  notes: string;
}
