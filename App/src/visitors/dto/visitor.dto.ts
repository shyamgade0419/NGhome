import { IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisitorType } from '@prisma/client';
import { Trim } from '../../common/decorators/trim.decorator';
import { POLICY_LIMITS } from '../visitor-policy';

const PHONE = /^\+?\d{7,15}$/;
const VEHICLE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,18}[A-Za-z0-9]$/;

/** A resident invites a guest. The flat, society and creator come from the sign-in, never from this body. */
export class CreateInvitationDto {
  @ApiProperty() @Trim() @IsString() @MinLength(2) @MaxLength(100)
  visitorName: string;

  @ApiPropertyOptional() @IsOptional() @Trim() @Matches(PHONE, { message: 'visitorPhone must be a mobile number (7–15 digits)' })
  visitorPhone?: string;

  @ApiPropertyOptional({ enum: VisitorType }) @IsOptional() @IsEnum(VisitorType)
  visitorType?: VisitorType;

  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(200)
  note?: string;

  @ApiPropertyOptional({ description: 'Defaults to now.' }) @IsOptional() @IsDateString()
  validFrom?: string;

  @ApiProperty() @IsDateString()
  validUntil: string;

  @ApiPropertyOptional({ description: 'How many entries this invitation admits. Default 1.' }) @IsOptional() @IsInt() @Min(1) @Max(POLICY_LIMITS.maxUsesPerInvite.max)
  maxUses?: number;
}

/** A guard registers someone who arrived without an invitation. */
export class WalkInDto {
  @ApiProperty() @IsUUID()
  flatId: string;

  @ApiProperty() @Trim() @IsString() @MinLength(2) @MaxLength(100)
  visitorName: string;

  @ApiPropertyOptional() @IsOptional() @Trim() @Matches(PHONE, { message: 'visitorPhone must be a mobile number (7–15 digits)' })
  visitorPhone?: string;

  @ApiPropertyOptional({ enum: VisitorType }) @IsOptional() @IsEnum(VisitorType)
  visitorType?: VisitorType;

  @ApiPropertyOptional() @IsOptional() @Trim() @Matches(VEHICLE, { message: 'vehicleNumber must be 4–20 letters, digits, spaces or dashes' })
  vehicleNumber?: string;

  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(200)
  purpose?: string;

  @ApiProperty({ description: 'A value the app generates once per attempt, so a retried submission is recognised.' })
  @IsString() @IsNotEmpty() @MaxLength(64)
  clientRequestId: string;
}

/** A guard checks an invitation code at the gate. */
export class ScanCodeDto {
  @ApiProperty() @IsString() @MinLength(4) @MaxLength(20)
  code: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(64)
  clientRequestId: string;
}

export class DecisionDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(200)
  note?: string;
}

export class OverrideDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT'])
  action: 'APPROVE' | 'REJECT';

  @ApiProperty({ description: 'Why the committee is overriding. Recorded in the audit trail.' })
  @Trim() @IsString() @MinLength(3) @MaxLength(300)
  reason: string;
}

export class UpdateVisitorPolicyDto {
  @ApiPropertyOptional({ enum: ['REQUIRED', 'NOT_REQUIRED'] }) @IsOptional() @IsIn(['REQUIRED', 'NOT_REQUIRED'])
  walkInApproval?: 'REQUIRED' | 'NOT_REQUIRED';

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(POLICY_LIMITS.maxInviteDays.min) @Max(POLICY_LIMITS.maxInviteDays.max)
  maxInviteDays?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(POLICY_LIMITS.maxUsesPerInvite.min) @Max(POLICY_LIMITS.maxUsesPerInvite.max)
  maxUsesPerInvite?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(POLICY_LIMITS.approvalWindowMinutes.min) @Max(POLICY_LIMITS.approvalWindowMinutes.max)
  approvalWindowMinutes?: number;
}
