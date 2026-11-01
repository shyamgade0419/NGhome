import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetSocietyWhatsappDto {
  @ApiProperty({ description: "Allow this society to send WhatsApp messages through the platform's WhatsApp number." })
  @IsBoolean()
  allowed: boolean;
}
