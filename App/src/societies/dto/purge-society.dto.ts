import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PurgeSocietyDto {
  @ApiProperty({ description: "The society's name exactly as the console shows it — typed by the person confirming." })
  @IsString() @IsNotEmpty() @MaxLength(250)
  confirmName: string;
}
