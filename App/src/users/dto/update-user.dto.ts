import { IsString, IsOptional, IsBoolean, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  // Unvalidated before — same login-identity concern as registerSociety's
  // AdminInfoDto.phone (see that file): an admin editing a resident's
  // phone here, or a resident editing their own, needs the same clean
  // shape join-code signup already enforces so phone login keeps working.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{7,15}$/, { message: 'phone must be a valid mobile number (7–15 digits)' })
  phone?: string;
}
