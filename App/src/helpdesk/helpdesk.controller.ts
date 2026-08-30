import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole, MaintenanceRequestStatus } from '@prisma/client';
import { HelpdeskService } from './helpdesk.service';
import { CreateMaintenanceRequestDto, UpdateRequestStatusDto } from './dto/create-request.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Helpdesk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('helpdesk')
export class HelpdeskController {
  constructor(private readonly service: HelpdeskService) {}

  @Post()
  @ApiOperation({ summary: 'Resident submits a maintenance request' })
  create(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMaintenanceRequestDto,
  ) {
    return this.service.create(societyId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List requests — admin sees all, resident sees own' })
  @ApiQuery({ name: 'status', required: false, enum: MaintenanceRequestStatus })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  findAll(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: MaintenanceRequestStatus,
    @Query('category') category?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const forResident = !user.isPlatformAdmin && user.currentRole === 'RESIDENT';
    return this.service.findAll(societyId, {
      forResident,
      residentId: user.id,
      status,
      category,
      page: +page,
      limit: +limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single maintenance request' })
  findOne(
    @SocietyId() societyId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(societyId, id);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_STAFF)
  @ApiOperation({ summary: 'Admin updates status, assigns staff, adds notes' })
  updateStatus(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRequestStatusDto,
  ) {
    return this.service.updateStatus(societyId, id, dto);
  }
}
