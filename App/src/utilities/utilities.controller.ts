import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { UtilitiesService } from './utilities.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { SocietyId } from '../common/decorators/society-id.decorator';

const NUMBER = /^[A-Za-z0-9][A-Za-z0-9 \-/]{2,24}$/;
/** What people paste has spaces around it; check the text, not the spaces. */
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

class CreateConnectionDto {
  @IsString()
  @MaxLength(30)
  providerCode: string;

  /** Required when providerCode is OTHER. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  providerName?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'The website address must start with https://' })
  @MaxLength(300)
  providerUrl?: string;

  @trim()
  @IsString()
  @Matches(NUMBER, { message: 'The consumer number is letters and digits only (3 to 25 characters), as printed on your bill.' })
  consumerNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  nickname?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  reminderDay?: number;

  @IsOptional()
  @IsBoolean()
  remindersOn?: boolean;
}

class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  providerCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  providerName?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'The website address must start with https://' })
  @MaxLength(300)
  providerUrl?: string;

  @IsOptional()
  @trim()
  @IsString()
  @Matches(NUMBER, { message: 'The consumer number is letters and digits only (3 to 25 characters), as printed on your bill.' })
  consumerNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  nickname?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  reminderDay?: number;

  @IsOptional()
  @IsBoolean()
  remindersOn?: boolean;
}

/**
 * A flat's electricity connection(s) and the monthly reminder. Open to the flat's own residents only; the society's admin cannot
 * list them, because a consumer number is personal. Every route works on the caller's own flat in the caller's token.
 */
@ApiTags('Utility connections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('utility-connections')
export class UtilitiesController {
  constructor(private readonly utilities: UtilitiesService) {}

  @Get('providers')
  @ApiOperation({ summary: 'The electricity companies to choose from, with their websites, and the default reminder day' })
  providers() {
    return this.utilities.providers();
  }

  @Get()
  @ApiOperation({ summary: 'Resident: my flat\'s saved electricity connections' })
  list(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.utilities.list(societyId, user.id, user.flatId);
  }

  @Post()
  @ApiOperation({ summary: 'Resident: save an electricity connection and be reminded each month to check and pay the bill' })
  create(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConnectionDto) {
    return this.utilities.create(societyId, user.id, user.flatId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Resident: change a saved connection or its reminder' })
  update(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConnectionDto) {
    return this.utilities.update(societyId, user.id, user.flatId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Resident: remove a saved connection' })
  remove(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.utilities.remove(societyId, user.id, user.flatId, id);
  }
}
