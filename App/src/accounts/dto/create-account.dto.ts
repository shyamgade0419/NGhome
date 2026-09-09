import { IsString, IsOptional, IsNumber, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';

/**
 * A class rather than an interface so the global ValidationPipe runs — as an
 * interface, Nest skipped validation entirely and an account could be created
 * with any accountType string or a negative opening balance.
 *
 * Every field the clients send is declared: with validation now active,
 * forbidNonWhitelisted turns anything missing here into a 400.
 */
export class CreateAccountDto {
  @ApiProperty({ description: 'e.g. "HDFC Current A/c", "Petty Cash"' })
  @IsString()
  name: string;

  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  /** Last few digits are enough — full numbers are deliberately not stored. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountNumberMasked?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ifscCode?: string;

  @ApiPropertyOptional({ description: 'What the account holds today.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  openingBalance?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

/** Same fields, all optional, same validators — so PATCH is validated too.
 *  `Partial<CreateXDto>` would not be: a mapped type erases to Object at
 *  runtime and Nest skips validation entirely. */
export class UpdateAccountDto extends PartialType(CreateAccountDto) {}
