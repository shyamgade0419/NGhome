import {
  IsString, IsOptional, IsNumber, IsBoolean, IsDateString, IsEnum, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EventStatus } from '@prisma/client';

/**
 * A class rather than an interface so the global ValidationPipe runs — as an
 * interface, validation was skipped entirely and an event could carry a
 * negative actualCost, which recordExpense would then turn into an expense
 * that *increased* the linked fund's balance when recorded.
 *
 * Every field the mobile form sends is declared: with validation now active,
 * forbidNonWhitelisted turns anything missing here into a 400.
 */
export class CreateEventDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsDateString()
  eventDate: string;

  /** Informational while planning — linking a fund moves no money by itself. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fundId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualCost?: number;

  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVisibleToResidents?: boolean;
}

/** Same fields, all optional, same validators — so PATCH is validated too.
 *  `Partial<CreateXDto>` would not be: a mapped type erases to Object at
 *  runtime and Nest skips validation entirely. */
export class UpdateEventDto extends PartialType(CreateEventDto) {}
