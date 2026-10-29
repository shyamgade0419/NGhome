import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMailSettingsDto {
  @ApiProperty({ example: 'smtp.example.com' })
  @IsString()
  @MaxLength(255)
  host: string;

  @ApiProperty({ example: 465, description: '465 connects over SSL; 587 and others start in the clear and upgrade.' })
  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @ApiPropertyOptional({ nullable: true, example: 'support@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Leave blank to keep the saved password.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'support@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromAddress?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'NG Home' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fromName?: string | null;
}
