import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { SystemRole } from '@prisma/client';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';

class TestWhatsappDto {
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone: string;
}

@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Get('status')
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Is WhatsApp automation set up and connected, and what is waiting to be sent' })
  status(@SocietyId() societyId: string) {
    return this.whatsapp.status(societyId);
  }

  @Get('messages')
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'The latest automatic WhatsApp messages and whether each was sent' })
  messages(@SocietyId() societyId: string, @Query('limit') limit = 30) {
    return this.whatsapp.recent(societyId, +limit);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Send one test message to a number, to prove the connection works' })
  test(@SocietyId() societyId: string, @Body() dto: TestWhatsappDto) {
    return this.whatsapp.sendTest(societyId, dto.phone);
  }
}
