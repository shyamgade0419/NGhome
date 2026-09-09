import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { EventsService, CreateEventDto } from './events.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.COMMITTEE_MEMBER)
  @ApiOperation({ summary: 'Create an event or planned/upcoming activity' })
  create(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventsService.create(societyId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List events (residents see visible-only events)' })
  findAll(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.eventsService.findAll(societyId, +page, +limit, user.currentRole === 'RESIDENT');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event details' })
  findOne(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.eventsService.findOne(societyId, id, user.currentRole === 'RESIDENT');
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.COMMITTEE_MEMBER)
  @ApiOperation({ summary: 'Update an event' })
  update(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateEventDto>,
  ) {
    return this.eventsService.update(societyId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an event' })
  async remove(@SocietyId() societyId: string, @Param('id') id: string) {
    await this.eventsService.remove(societyId, id);
  }

  @Post(':id/record-expense')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Record this event\'s actual cost as a real Expense, debiting its linked fund' })
  recordExpense(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.eventsService.recordExpense(societyId, id, user.id);
  }

  @Delete(':id/record-expense')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({
    summary: 'Undo a recorded event expense, returning the money to its fund',
  })
  unrecordExpense(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.eventsService.unrecordExpense(societyId, id, user.id);
  }
}
