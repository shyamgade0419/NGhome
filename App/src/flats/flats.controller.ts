import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { FlatsService } from './flats.service';
import { CreateFlatDto } from './dto/create-flat.dto';
import { BulkCreateFlatDto } from './dto/bulk-create-flat.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Flats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('flats')
export class FlatsController {
  constructor(private readonly flatsService: FlatsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Create a flat/unit' })
  create(@SocietyId() societyId: string, @Body() dto: CreateFlatDto) {
    return this.flatsService.create(societyId, dto);
  }

  @Post('bulk')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Bulk-create flats (CSV/Excel import) — per-row success/failure, not all-or-nothing' })
  bulkCreate(@SocietyId() societyId: string, @Body() dto: BulkCreateFlatDto) {
    return this.flatsService.bulkCreate(societyId, dto.flats);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.SOCIETY_STAFF)
  @ApiOperation({ summary: 'List all flats in society' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'buildingId', required: false })
  findAll(
    @SocietyId() societyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('buildingId') buildingId?: string,
  ) {
    return this.flatsService.findAll(societyId, +page, +limit, buildingId);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get resident own flat' })
  async findMyFlat(@CurrentUser() user: AuthenticatedUser, @SocietyId() societyId: string) {
    if (!user.flatId) throw new Error('No flat assigned');
    return this.flatsService.findMyFlat(societyId, user.id, user.flatId);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.SOCIETY_STAFF)
  @ApiOperation({ summary: 'Get flat by ID' })
  findOne(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.flatsService.findOne(societyId, id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Update a flat' })
  update(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateFlatDto>,
  ) {
    return this.flatsService.update(societyId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a flat' })
  remove(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.flatsService.softDelete(societyId, id);
  }
}
