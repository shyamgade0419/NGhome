import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';

@ApiTags('Buildings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Create a building' })
  create(@SocietyId() societyId: string, @Body() dto: CreateBuildingDto) {
    return this.buildingsService.create(societyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all buildings in society' })
  findAll(@SocietyId() societyId: string) {
    return this.buildingsService.findAll(societyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get building by ID' })
  findOne(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.buildingsService.findOne(societyId, id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Update a building' })
  update(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateBuildingDto>,
  ) {
    return this.buildingsService.update(societyId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a building' })
  remove(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.buildingsService.softDelete(societyId, id);
  }

  @Post(':id/floors')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Add a floor to a building' })
  addFloor(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() body: { number: number; name?: string },
  ) {
    return this.buildingsService.addFloor(societyId, id, body.number, body.name);
  }
}
