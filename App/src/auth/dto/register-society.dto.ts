import {
  IsString, IsEmail, IsNotEmpty, IsOptional, MinLength, MaxLength, ValidateNested, Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from '../../common/decorators/trim.decorator';

class SocietyInfoDto {
  @ApiProperty({ example: 'Green Valley Apartments' })
  @Trim()
  @IsString() @IsNotEmpty() @MinLength(3) @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'MH-2023-12345' })
  @Trim()
  @IsOptional() @IsString() @MaxLength(100)
  registrationNumber?: string;

  @ApiProperty({ example: 'Plot No. 12, Sector 5' })
  @Trim()
  @IsString() @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'Mumbai' })
  @Trim()
  @IsString() @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Maharashtra' })
  @Trim()
  @IsString() @IsNotEmpty()
  state: string;

  @ApiProperty({ example: '400001' })
  @Trim()
  @IsString() @IsNotEmpty()
  pinCode: string;

  @ApiProperty({ example: 'India' })
  @Trim()
  @IsString() @IsNotEmpty()
  country: string;

  @ApiProperty({ example: 'admin@greenvalley.com' })
  @IsEmail()
  contactEmail: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString() @IsNotEmpty()
  contactPhone: string;
}

class AdminInfoDto {
  @ApiProperty({ example: 'John' })
  @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  // Unvalidated before — the account this creates is a login identity
  // (phone login matches against it), so it needs the same clean,
  // consistent shape join-code signup already enforces, not "any string".
  @ApiProperty({ example: '+919876543210' })
  @IsString() @IsNotEmpty()
  @Matches(/^\+?\d{7,15}$/, { message: 'phone must be a valid mobile number (7–15 digits)' })
  phone: string;

  @ApiProperty({ minLength: 8 })
  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128)
  password: string;
}

export class RegisterSocietyDto {
  @ApiProperty({ type: SocietyInfoDto })
  @ValidateNested()
  @Type(() => SocietyInfoDto)
  society: SocietyInfoDto;

  @ApiProperty({ type: AdminInfoDto })
  @ValidateNested()
  @Type(() => AdminInfoDto)
  admin: AdminInfoDto;
}
