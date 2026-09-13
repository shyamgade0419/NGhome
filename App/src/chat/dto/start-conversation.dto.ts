import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartConversationDto {
  @ApiProperty({ description: 'The other resident to chat with — must be an active member of the same society' })
  @IsString()
  userId: string;
}
