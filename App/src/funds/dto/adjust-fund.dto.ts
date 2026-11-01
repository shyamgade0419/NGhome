import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const FUND_DIRECTIONS = ['INCREASE', 'DECREASE'] as const;
export type FundDirection = (typeof FUND_DIRECTIONS)[number];

/**
 * Raising or lowering a fund by hand: a contribution that arrived, money handed back, or a figure that was
 * entered wrongly. The comment is required because the fund's balance changes with no bill, payment or
 * expense behind it, so the reason has to be on the record.
 */
export class AdjustFundDto {
  @ApiProperty({ enum: FUND_DIRECTIONS })
  @IsIn(FUND_DIRECTIONS as unknown as string[])
  direction: FundDirection;

  @ApiProperty({ description: 'How much to add or take out. Greater than zero.' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ description: 'Why, e.g. "Donations for Ganesh festival" or "Entered twice by mistake".' })
  @IsString()
  @MinLength(3, { message: 'Add a comment of at least 3 characters saying why' })
  @MaxLength(500)
  comment: string;

  @ApiPropertyOptional({ description: 'Defaults to now.' })
  @IsOptional()
  @IsDateString()
  date?: string;

  /**
   * A fund is an earmark inside a bank account, so whether the bank moves as well depends on what happened:
   *  - omitted: the money is already in (or stays in) the accounts and only the earmark changes, so the
   *    general money rises or falls by the same amount and the bank total is untouched;
   *  - given: money really came into, or went out of, this account, so it rises or falls with the fund.
   */
  @ApiPropertyOptional({ description: 'Bank account that also receives or loses this amount. Omit for a pure earmark change.' })
  @IsOptional()
  @IsString()
  accountId?: string;
}
