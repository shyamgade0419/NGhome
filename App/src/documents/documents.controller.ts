import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, UseInterceptors,
  UploadedFile, Res, StreamableFile, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UploadDocumentMetaDto } from './dto/upload-document-meta.dto';
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
  @ApiOperation({ summary: 'Register a document by link (no file storage) — admin\'s existing paste-a-link flow' })
  create(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documentsService.create(societyId, user.id, user.currentRole === 'RESIDENT', user.flatId, dto);
  }

  /**
   * Real file upload (SFTP-backed). A resident's upload is always forced to
   * FLAT_PRIVATE on their own flat server-side — see documentsService.upload
   * — so the accessLevel/flatId fields here only matter for admin/staff.
   * 10MB cap: generous for a tax receipt or a scanned document, small
   * enough that one bad actor can't fill the SFTP server through this form.
   */
  @Post('upload')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_STAFF, SystemRole.RESIDENT, SystemRole.COMMITTEE_MEMBER)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an actual file — residents get a private-to-their-flat document' })
  async upload(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentMetaDto,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded — attach it under the "file" field.');
    if (!body?.title?.trim()) throw new BadRequestException('title is required');

    return this.documentsService.upload(
      societyId,
      user.id,
      user.currentRole === 'RESIDENT',
      user.flatId,
      file,
      {
        title: body.title.trim(),
        description: body.description,
        category: body.category,
        accessLevel: body.accessLevel,
        flatId: body.flatId,
      },
    );
  }

  @Get()
  @ApiOperation({ summary: 'List documents — residents see allowed access levels plus their own flat\'s private ones' })
  findAll(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('category') category?: string,
  ) {
    return this.documentsService.findAll(societyId, user.currentRole === 'RESIDENT', category, user.flatId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document metadata' })
  findOne(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.documentsService.findOne(societyId, id, user.currentRole === 'RESIDENT', user.flatId);
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Download the actual file for an uploaded (SFTP-backed) document' })
  async downloadFile(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, fileName, mimeType } = await this.documentsService.getFileBuffer(
      societyId,
      id,
      user.currentRole === 'RESIDENT',
      user.flatId,
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    });
    return new StreamableFile(buffer);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.RESIDENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a document — admin can remove any; a resident only their own flat documents' })
  remove(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.documentsService.softDelete(societyId, id, user.id, user.currentRole === 'SOCIETY_ADMIN');
  }
}
