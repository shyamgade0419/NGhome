import {
  IsString, IsOptional, IsNumber, IsEnum, IsDateString, IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

export class SubmitPaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maintenanceBillId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingPeriodId?: string;

  // Strictly positive — ₹0 is not a payment, and a negative amount would
  // credit an account for a "debit" while the ledger records it as a
  // CREDIT transaction, corrupting the books.
  @ApiProperty()
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty()
  @IsDateString()
  paymentDate: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utrNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chequeNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
