import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetAdminStatusDto {
  @ApiProperty({ description: 'false deactivates the platform admin (they can no longer sign in); true reactivates.' })
  @IsBoolean()
  isActive: boolean;
}
