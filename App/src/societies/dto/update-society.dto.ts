import { IsString, IsOptional, IsEmail, IsNotEmpty, MaxLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from '../../common/decorators/trim.decorator';

/**
 * What a society admin may change about their own society. The route used to
 * type its body as Partial<CreateSocietyDto>, which erases to Object at
 * runtime — so nothing was validated and the whole body reached Prisma,
 * letting an admin set columns like isActive, joinCode or deletedAt. This
 * class lists the eight fields the apps send, and the global pipe rejects
 * anything else.
 */
export class UpdateSocietyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString() @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString() @MaxLength(500)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString() @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString() @MaxLength(100)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString() @MaxLength(20)
  pincode?: string;

  /** The apps send '' for a blank field, so only a non-empty value has to be an email. */
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @ValidateIf((_, value) => value !== '')
  @IsEmail() @MaxLength(254)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString() @MaxLength(30)
  phone?: string;
}
