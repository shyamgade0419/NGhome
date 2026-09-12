import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

// Previously a plain `{ userId; flatId?; role; isPrimary? }` inline type —
// invisible to the global ValidationPipe, so `role` (a privilege
// assignment) was never checked against the SystemRole enum at the API
// boundary; an invalid value would only ever surface as an opaque 500 from
// Postgres's own enum constraint, not a clean 400. flatId's tenancy check
// already happens in UsersService.addToSociety (DEFECT-1) — this closes
// the input-shape gap around it, not a tenancy one.
export class AddMemberDto {
  @ApiProperty()
  @IsString()
  userId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  flatId?: string;

  @ApiProperty({ enum: SystemRole })
  @IsEnum(SystemRole)
  role: SystemRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
