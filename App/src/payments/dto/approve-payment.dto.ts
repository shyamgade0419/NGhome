import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Previously a plain `{ accountId: string; notes?: string }` inline type —
// invisible to the global ValidationPipe, so a missing/malformed accountId
// reached PaymentsService.approve() with no 400 at the API boundary
// (PaymentsService itself already re-validates accountId belongs to this
// society before crediting anything, so this closes an input-shape gap,
// not a tenancy one).
export class ApprovePaymentDto {
  @ApiProperty()
  @IsString()
  accountId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
