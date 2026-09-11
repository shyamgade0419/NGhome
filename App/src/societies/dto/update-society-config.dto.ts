import {
  IsOptional, IsString, IsInt, IsBoolean, IsNumber, Min, Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycleType } from '@prisma/client';

export class UpdateSocietyConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  financialYearStartMonth?: number;

  @ApiPropertyOptional({ enum: BillingCycleType })
  @IsOptional()
  @IsString()
  billingCycle?: BillingCycleType;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  billingDueDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  gracePeriodDays?: number;

  @ApiPropertyOptional({ enum: ['FIXED', 'PERCENTAGE'] })
  @IsOptional()
  @IsString()
  lateFeeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFeeValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFeeMaxAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoicePrefix?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  paymentVerificationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowPaymentProofUpload?: boolean;

  @ApiPropertyOptional({
    description:
      'Show the total bank-account balance to residents. Fund balances are NOT governed by ' +
      'this — each fund carries its own isVisibleToResidents.',
  })
  @IsOptional()
  @IsBoolean()
  showAccountBalancesToResidents?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showExpensesToResidents?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  publishStatementToResidents?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  publishMeetingMinutes?: boolean;

  @ApiPropertyOptional({ description: 'Society UPI ID for direct payment (stored in additionalConfig)' })
  @IsOptional()
  @IsString()
  upiId?: string;

  @ApiPropertyOptional({
    description: 'Whether this society bills for water usage (stored in additionalConfig). Defaults to true for societies that never set it, so existing behavior is unchanged.',
  })
  @IsOptional()
  @IsBoolean()
  waterBillingEnabled?: boolean;
}
