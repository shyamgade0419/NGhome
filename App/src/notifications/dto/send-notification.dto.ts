import { IsString, IsOptional, IsEnum, IsArray, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannel, AnnouncementAudience } from '@prisma/client';

export class SendNotificationDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  body: string;

  @ApiProperty()
  @IsString()
  type: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: NotificationChannel, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(NotificationChannel, { each: true })
  channels?: NotificationChannel[];

  @ApiPropertyOptional({
    enum: AnnouncementAudience,
    description: 'Who it goes to: everyone (the default), the committee or the staff, or the buildings or flats named in audienceConfig.',
  })
  @IsOptional()
  @IsEnum(AnnouncementAudience)
  audience?: AnnouncementAudience;

  @ApiPropertyOptional({
    description: 'Which buildings (buildingIds, for BUILDING or BLOCK) or flats (flatIds, for SPECIFIC_FLATS) it goes to.',
    example: { buildingIds: ['…'] },
  })
  @IsOptional()
  @IsObject()
  audienceConfig?: { buildingIds?: string[]; flatIds?: string[] };
}
