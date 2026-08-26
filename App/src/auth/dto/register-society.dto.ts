import {
  IsString, IsEmail, IsNotEmpty, IsOptional, MinLength, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SocietyInfoDto {
  @ApiProperty({ example: 'Green Valley Apartments' })
  @IsString() @IsNotEmpty() @MinLength(3) @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'MH-2023-12345' })
  @IsOptional() @IsString() @MaxLength(100)
  registrationNumber?: string;

  @ApiProperty({ example: 'Plot No. 12, Sector 5' })
  @IsString() @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString() @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Maharashtra' })
  @IsString() @IsNotEmpty()
  state: string;

  @ApiProperty({ example: '400001' })
  @IsString() @IsNotEmpty()
  pinCode: string;

  @ApiProperty({ example: 'India' })
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

  @ApiProperty({ example: '+919876543210' })
  @IsString() @IsNotEmpty()
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
