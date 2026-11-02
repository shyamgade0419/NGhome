import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWhatsappSettingsDto {
  @ApiProperty({ example: 'http://openwa:2785', description: 'Where the WhatsApp gateway (OpenWA) is reachable from this server.' })
  @IsString()
  @MaxLength(300)
  url: string;

  @ApiPropertyOptional({ nullable: true, description: 'The gateway API key. Blank keeps the saved one; required the first time.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string | null;
}
