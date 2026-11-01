import {
  IsString, IsOptional, IsNumber, IsEnum, IsDateString, IsPositive, IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

/** The admin or accountant recording that a flat has paid — cash handed over, a cheque, a transfer seen in the bank. */
export class RecordPaymentDto {
  @ApiProperty({ description: 'The bill being paid. Earlier unpaid months of the same flat are cleared first.' })
  @IsString()
  @IsNotEmpty()
  maintenanceBillId: string;

  @ApiProperty({ description: 'The bank account the money went into' })
  @IsString()
  @IsNotEmpty()
  accountId: string;

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
