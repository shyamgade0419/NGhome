import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateForumReplyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;
}
