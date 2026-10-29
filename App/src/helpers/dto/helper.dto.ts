import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HelperRole } from '@prisma/client';
import { Trim } from '../../common/decorators/trim.decorator';

const PHONE = /^\+?[\d\s-]{7,20}$/;

/** A resident adds someone who works in their home. The flat and society come from the sign-in. */
export class AddHelperDto {
  @ApiProperty() @Trim() @IsString() @MinLength(2) @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'Needed to recognise the same person working for another flat.' })
  @IsOptional() @Trim() @Matches(PHONE, { message: 'phone must be a mobile number (7–15 digits)' })
  phone?: string;

  @ApiProperty({ enum: HelperRole }) @IsEnum(HelperRole)
  role: HelperRole;
}

/** A guard lets a helper in by picking them from the list. */
export class HelperCheckInDto {
  @ApiProperty({ description: 'A value the app generates once per attempt, so a retried submission is recognised.' })
  @IsString() @IsNotEmpty() @MaxLength(64)
  clientRequestId: string;
}

/** A guard lets a helper in with the pass code the helper shows. */
export class HelperCodeDto {
  @ApiProperty() @IsString() @MinLength(4) @MaxLength(20)
  code: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(64)
  clientRequestId: string;
}

export class SuspendHelperDto {
  @ApiProperty({ description: 'Why. Kept in the audit trail and shown to the residents who employ them.' })
  @Trim() @IsString() @MinLength(3) @MaxLength(300)
  reason: string;
}
