import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeletePlatformUserDto {
  @ApiProperty({ description: "The account's email address, typed by the person confirming the delete." })
  @IsString() @IsNotEmpty() @MaxLength(320)
  confirmEmail: string;
}
