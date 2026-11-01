import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FUND_DIRECTIONS, FundDirection } from '../../funds/dto/adjust-fund.dto';

/**
 * Bringing an account's balance in line with the bank by hand, e.g. when the bank statement shows interest
 * the society never recorded, or a figure was entered wrongly. The comment is required because the balance
 * changes with no payment or expense behind it.
 */
export class AdjustAccountDto {
  @ApiProperty({ enum: FUND_DIRECTIONS })
  @IsIn(FUND_DIRECTIONS as unknown as string[])
  direction: FundDirection;

  @ApiProperty({ description: 'How much to add or take off the balance. Greater than zero.' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ description: 'Why, e.g. "Interest credited by the bank" or "Opening balance was typed wrongly".' })
  @IsString()
  @MinLength(3, { message: 'Add a comment of at least 3 characters saying why' })
  @MaxLength(500)
  comment: string;

  @ApiPropertyOptional({ description: 'Defaults to now.' })
  @IsOptional()
  @IsDateString()
  date?: string;
}
