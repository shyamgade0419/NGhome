import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefundAdvanceDto {
  @ApiProperty()
  @IsUUID()
  flatId: string;

  /** How much of the flat's advance to pay back. */
  @ApiProperty({ example: 1500 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount: number;

  /** The account the money is paid out of. */
  @ApiProperty()
  @IsUUID()
  accountId: string;

  @ApiProperty({ example: 'Flat sold, advance returned' })
  @IsString()
  @MinLength(3, { message: 'Give a short reason for the refund' })
  @MaxLength(200)
  reason: string;

  /** A UTR or cheque number, if there is one. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;
}
