import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Previously a plain `{ accountId: string }` inline type — invisible to the
// global ValidationPipe. ExpensesService.markPaid() already re-validates
// accountId belongs to this society before debiting anything, so this
// closes an input-shape gap (a missing/malformed accountId reaching the
// service with no clean 400), not a tenancy one.
export class MarkExpensePaidDto {
  @ApiProperty()
  @IsString()
  accountId: string;

  /**
   * The fund this is paid out of, when it is not ordinary maintenance money. The fund falls by the same
   * amount as the account, which is what keeps the funds from adding up to more than the bank holds.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fundId?: string;
}
