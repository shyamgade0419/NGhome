import {
  IsString, IsEmail, IsNotEmpty, IsUUID, MinLength, MaxLength, Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinSocietyDto {
  @ApiProperty({
    example: 'NKHM-7R2P',
    description: '8-character invite code shown in admin Settings → Society',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(12)
  joinCode: string;

  @ApiProperty({
    description: 'ID of the flat the resident occupies (from GET /societies/by-code/:code)',
    example: 'uuid-of-flat',
  })
  @IsUUID()
  flatId: string;

  @ApiProperty({ example: 'Ravi' })
  @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Kumar' })
  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'ravi@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '+919876543210',
    description: 'WhatsApp-capable mobile number — used for billing reminders',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d{7,15}$/, { message: 'phone must be a valid mobile number (7–15 digits)' })
  phone: string;

  @ApiProperty({ minLength: 8 })
  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128)
  password: string;
}
