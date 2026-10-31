import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_OPENING_AMOUNT } from '../opening-balances';

export class OpeningBalanceRowDto {
  /** The flat's code, as in Flats (A-101). Spaces and dashes are forgiven when it is unambiguous. */
  @ApiProperty({ example: 'A-101' })
  @IsString()
  @MaxLength(50)
  flatCode: string;

  /** What the flat owed at the as-of date. Zero removes an opening balance that has had no payment. */
  @ApiProperty({ example: 12000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_OPENING_AMOUNT)
  amount: number;

  @ApiPropertyOptional({ example: 'Paper ledger, to March' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class SaveOpeningBalancesDto {
  /** The date the paper or Excel records are correct to. */
  @ApiProperty({ example: '2026-03-31' })
  @IsDateString()
  asOfDate: string;

  @ApiProperty({ type: [OpeningBalanceRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  // A society's flats; a sane bound so one request cannot hold a transaction open for thousands of rows.
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceRowDto)
  rows: OpeningBalanceRowDto[];

  /** Check the rows and say what would happen, without saving anything. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class CorrectOpeningBalanceDto {
  /** What the flat really owed at the as-of date. */
  @ApiProperty({ example: 11000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_OPENING_AMOUNT)
  amount: number;

  /** Why it is being corrected — kept in the audit trail. */
  @ApiProperty({ example: 'Ledger page 14 was misread' })
  @IsString()
  @MinLength(3, { message: 'Give a short reason for the correction' })
  @MaxLength(200)
  reason: string;
}
