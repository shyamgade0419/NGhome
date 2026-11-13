import { IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UsageLimitDto } from './allocate-water-costs.dto';

/**
 * Sets, or switches off, the society's charge for heavy water use on its own (Settings → Billing), without calculating any
 * month. `null` switches it off. The service re-checks the numbers, so these ranges are only the first gate.
 */
export class SetUsageLimitDto {
  @ApiPropertyOptional({ type: UsageLimitDto, nullable: true, description: 'The limit and what is charged above it, or null for no limit.' })
  @IsOptional()
  @ValidateIf((o: SetUsageLimitDto) => o.usageLimit !== null && o.usageLimit !== undefined)
  @ValidateNested()
  @Type(() => UsageLimitDto)
  usageLimit?: UsageLimitDto | null;
}
