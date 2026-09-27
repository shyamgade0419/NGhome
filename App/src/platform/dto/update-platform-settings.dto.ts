import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** name@handle — e.g. 9876543210@ybl, shyam.g@okhdfcbank. */
export const UPI_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export const PRICING_MODES = ['FREE', 'PAID'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export class UpdatePlatformSettingsDto {
  @ApiProperty({
    enum: PRICING_MODES,
    description: 'PAID is recorded only — nothing enforces billing yet.',
  })
  @IsIn(PRICING_MODES)
  pricingMode: PricingMode;

  @ApiProperty({ description: 'Show the optional "support the developer" prompt to users.' })
  @IsBoolean()
  supportEnabled: boolean;

  @ApiPropertyOptional({ nullable: true, example: 'name@okhdfcbank' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @Matches(UPI_ID_PATTERN, { message: 'supportUpiId must be a UPI ID like name@bank' })
  supportUpiId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  supportPayeeName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  supportMessage?: string | null;
}
