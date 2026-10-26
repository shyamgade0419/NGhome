import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from '../../common/decorators/trim.decorator';
import { HEX_COLOR } from '../branding';

/**
 * A field left out keeps its current value; null (or an empty name) clears it.
 * The logo and colour get deeper checks in SocietyBrandingService — contrast
 * and the real bytes of the image — that a decorator cannot express.
 */
export class UpdateBrandingDto {
  @ApiPropertyOptional({ description: 'The name shown as the app name. Max 40 characters. null clears it.' })
  @IsOptional()
  @Trim()
  @IsString() @MaxLength(40)
  appName?: string | null;

  @ApiPropertyOptional({ description: 'Brand colour as #RRGGBB. Must hold 4.5:1 contrast against white. null clears it.' })
  @IsOptional()
  @Trim()
  @Matches(HEX_COLOR, { message: 'primaryColor must look like #1A5FB4' })
  primaryColor?: string | null;

  @ApiPropertyOptional({ description: 'A PNG, JPEG or WebP data URI, up to 200 KB. null clears it.' })
  @IsOptional()
  @IsString() @MaxLength(300_000)
  logoDataUri?: string | null;
}
