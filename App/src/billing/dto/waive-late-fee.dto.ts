import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WaiveLateFeeDto {
  /** Why the fine is being waived — kept in the audit trail. */
  @ApiProperty()
  @IsString()
  @MinLength(3, { message: 'Give a short reason for waiving the fine' })
  reason: string;
}
