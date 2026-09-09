import { IsString, IsOptional, IsNumber, IsBoolean, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

/**
 * A class rather than an interface so the global ValidationPipe runs — as an
 * interface, validation was skipped entirely and a fund could be created with
 * a negative opening balance.
 *
 * Every field the clients send is declared: with validation now active,
 * forbidNonWhitelisted turns anything missing here into a 400.
 */
export class CreateFundDto {
  @ApiProperty({ description: 'e.g. "Corpus Fund", "Sinking Fund"' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  /** The bank account this fund's money sits inside, if known. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({ description: 'What the fund already holds today.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  openingBalance?: number;

  /**
   * The only thing controlling whether residents see this fund. Defaults to
   * false in the service, so exposure is always a deliberate act.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVisibleToResidents?: boolean;
}

/** Same fields, all optional, same validators — so PATCH is validated too.
 *  `Partial<CreateXDto>` would not be: a mapped type erases to Object at
 *  runtime and Nest skips validation entirely. */
export class UpdateFundDto extends PartialType(CreateFundDto) {}
