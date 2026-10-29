import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryInstruction } from '@prisma/client';
import { Trim } from '../../common/decorators/trim.decorator';
import { EXPECTATION_LIMITS } from '../delivery-rules';

/** A resident says a delivery is coming. The flat and society come from the sign-in, never from this body. */
export class CreateExpectationDto {
  @ApiProperty({ description: 'Who is delivering, e.g. Amazon, Swiggy, "the plumber\'s parts".' })
  @Trim() @IsString() @MinLength(2) @MaxLength(60)
  company: string;

  @ApiProperty({ enum: DeliveryInstruction }) @IsEnum(DeliveryInstruction)
  instruction: DeliveryInstruction;

  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(200)
  note?: string;

  @ApiPropertyOptional({ description: `Defaults to ${EXPECTATION_LIMITS.defaultHours} hours from now.` }) @IsOptional() @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ description: 'How many deliveries may be let in on this instruction. Default 1. Only used by ALLOW_ENTRY.' })
  @IsOptional() @IsInt() @Min(1) @Max(EXPECTATION_LIMITS.maxUses)
  maxUses?: number;
}

/** A guard records a parcel left at the gate. */
export class ReceiveParcelDto {
  @ApiProperty() @IsUUID()
  flatId: string;

  @ApiProperty({ description: 'The courier or shop the parcel came with.' })
  @Trim() @IsString() @MinLength(2) @MaxLength(60)
  courier: string;

  @ApiPropertyOptional({ description: 'The name on the parcel, if it is not obvious.' }) @IsOptional() @Trim() @IsString() @MaxLength(100)
  recipientName?: string;

  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(200)
  note?: string;

  @ApiProperty({ description: 'A value the app generates once per attempt, so a retried submission is recognised.' })
  @IsString() @IsNotEmpty() @MaxLength(64)
  clientRequestId: string;
}

export class HandOverParcelDto {
  @ApiPropertyOptional({ description: 'Who took it from the gate.' }) @IsOptional() @Trim() @IsString() @MaxLength(100)
  collectedByName?: string;
}
