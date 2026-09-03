import { IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateFlatDto } from './create-flat.dto';

export class BulkCreateFlatDto {
  @ApiProperty({ type: [CreateFlatDto] })
  @IsArray()
  @ArrayMinSize(1)
  // A CSV/Excel import realistically tops out well under this — the cap is
  // just a sane upper bound so one bad request can't hang the request
  // thread iterating thousands of individual creates.
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateFlatDto)
  flats: CreateFlatDto[];
}
