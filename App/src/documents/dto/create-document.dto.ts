import { IsString, IsOptional, IsInt, IsEnum, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentAccessLevel } from '@prisma/client';

export class CreateDocumentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsString()
  fileName: string;

  // A link the client typed in, not a storage path — validated for scheme
  // separately (assertSafeLinkUrl) since only http/https may ever land here.
  @ApiProperty()
  @IsString()
  fileKey: string;

  @ApiProperty()
  @IsInt()
  fileSize: number;

  @ApiProperty()
  @IsString()
  mimeType: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  storageProvider?: string;

  @ApiPropertyOptional({ enum: DocumentAccessLevel })
  @IsOptional()
  @IsEnum(DocumentAccessLevel)
  accessLevel?: DocumentAccessLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedEntityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedEntityId?: string;

  // Only meaningful for admin/staff registering a private link on a
  // resident's behalf; a resident's own flatId is always used instead.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  flatId?: string;
}
