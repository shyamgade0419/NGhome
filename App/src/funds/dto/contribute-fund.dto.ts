import { IsString, IsOptional, IsNumber, IsDateString, IsPositive } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ContributeFundDto {
  @ApiProperty({ description: 'Amount to add to the fund. Must be greater than zero.' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({
    description: 'What this contribution was, e.g. "Corpus collection Q3" or "Transfer of FY surplus".',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Defaults to now if omitted.' })
  @IsOptional()
  @IsDateString()
  contributionDate?: string;

  /**
   * A fund is an earmark *within* a bank account, not a second pot of money —
   * so whether the bank balance also moves depends on where the money came
   * from, and only the person recording it knows that:
   *
   *  - omitted: the cash is already in the society's accounts (a resident
   *    payment that was approved, or surplus being set aside). Only the
   *    earmark grows; crediting an account here would count that money twice.
   *  - provided: the money is arriving now and was never recorded as a
   *    payment (a cash corpus collection, say), so the named account grows
   *    alongside the earmark.
   */
  @ApiPropertyOptional({
    description:
      'Bank account to credit as well. Omit when the money is already in the society accounts — ' +
      'passing it then would double-count.',
  })
  @IsOptional()
  @IsString()
  accountId?: string;
}
