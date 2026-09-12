import { IsString, IsNumber, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// The controller previously took `{ adjustment: number; note: string }` as
// a plain inline type — invisible to the global ValidationPipe (an
// interface/object-literal type has no runtime shape for class-validator to
// check, so it's forwarded completely unvalidated: NaN, Infinity-adjacent
// strings, or a missing field all reach the Decimal increment in
// BillingService.adjustBill as-is). @IsNumber() rejects anything that
// isn't a genuine finite number; a negative adjustment is intentionally
// still allowed (reducing a bill is a legitimate adjustment).
export class AdjustBillDto {
  @ApiProperty({ description: 'Amount to add to the bill total. Negative reduces it.' })
  @IsNumber()
  adjustment: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  note: string;
}
