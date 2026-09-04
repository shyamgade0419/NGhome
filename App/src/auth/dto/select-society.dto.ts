import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SelectSocietyDto {
  // Was societyId — ambiguous the moment one person holds more than one
  // active membership in the SAME society (a society admin who's also a
  // resident of their own flat, e.g.), which the schema has always
  // allowed. societyId alone can't tell those two memberships apart;
  // the specific membership row can.
  @ApiProperty({ description: 'Specific membership ID to activate for this session' })
  @IsString()
  @IsNotEmpty()
  membershipId: string;
}
