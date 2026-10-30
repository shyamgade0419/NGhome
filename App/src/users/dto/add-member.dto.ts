import { IsString, IsOptional, IsIn, IsBoolean, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResidencyType, SystemRole } from '@prisma/client';

/**
 * The roles a society admin may give someone in their own society. PLATFORM_ADMIN
 * is deliberately not here: it is a platform-level account flag, not a society
 * role, and a membership carrying it would just strip that person of every
 * society permission.
 */
export const ASSIGNABLE_ROLES: SystemRole[] = [
  SystemRole.SOCIETY_ADMIN,
  SystemRole.COMMITTEE_MEMBER,
  SystemRole.SOCIETY_ACCOUNTANT,
  SystemRole.SOCIETY_STAFF,
  SystemRole.SECURITY_GUARD,
  SystemRole.RESIDENT,
];

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

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES, { message: 'role must be one of: ' + ASSIGNABLE_ROLES.join(', ') })
  role: SystemRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  /** Owner or tenant. Owner when left out. */
  @ApiPropertyOptional({ enum: ResidencyType })
  @IsOptional()
  @IsEnum(ResidencyType)
  residencyType?: ResidencyType;
}
