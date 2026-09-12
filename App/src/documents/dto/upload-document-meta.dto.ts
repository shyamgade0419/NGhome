import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Multipart form fields (alongside the uploaded file) — all arrive as
// strings, so accessLevel is validated as a plain string here rather than
// against the DocumentAccessLevel enum; the service already ignores it
// entirely for a resident (forced to FLAT_PRIVATE) and only the admin
// paths reach resolveAccessAndFlat's own accessLevel handling.
export class UploadDocumentMetaDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  // Only meaningful for admin/staff/accountant/committee — a resident's
  // upload is always forced to FLAT_PRIVATE regardless of what's sent here.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accessLevel?: string;

  // Only meaningful for admin/staff uploading a private doc on a
  // resident's behalf; a resident's own flatId is always used instead.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  flatId?: string;
}
