import { IsEmail, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InvitePlatformAdminDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @Length(1, 50)
  firstName: string;

  @ApiProperty()
  @IsString()
  @Length(1, 50)
  lastName: string;
}
