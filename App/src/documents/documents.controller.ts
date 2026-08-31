import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { DocumentsService, CreateDocumentDto } from './documents.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_STAFF, SystemRole.RESIDENT)
  @ApiOperation({ summary: 'Upload document metadata' })
  create(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documentsService.create(societyId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List documents (residents see allowed access levels only)' })
  findAll(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('category') category?: string,
  ) {
    return this.documentsService.findAll(societyId, user.currentRole === 'RESIDENT', category);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document metadata' })
  findOne(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.documentsService.findOne(societyId, id, user.currentRole === 'RESIDENT');
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove document (soft delete)' })
  remove(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.documentsService.softDelete(societyId, id);
  }
}
