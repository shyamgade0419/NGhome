import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { AnnouncementsService, CreateAnnouncementDto } from './announcements.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_STAFF)
  @ApiOperation({ summary: 'Create an announcement' })
  create(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcementsService.create(societyId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List announcements (residents see published only)' })
  findAll(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const forResident = user.currentRole === 'RESIDENT';
    return this.announcementsService.findAll(societyId, +page, +limit, forResident);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get announcement by ID' })
  findOne(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const forResident = user.currentRole === 'RESIDENT';
    return this.announcementsService.findOne(societyId, id, forResident);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_STAFF)
  @ApiOperation({ summary: 'Update announcement' })
  update(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateAnnouncementDto>,
  ) {
    return this.announcementsService.update(societyId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an announcement' })
  async remove(@SocietyId() societyId: string, @Param('id') id: string) {
    await this.announcementsService.remove(societyId, id);
  }

  @Post(':id/publish')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_STAFF)
  @ApiOperation({ summary: 'Publish an announcement' })
  publish(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.announcementsService.publish(societyId, id);
  }
}
