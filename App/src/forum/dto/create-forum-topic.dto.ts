import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateForumTopicDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body: string;
}
