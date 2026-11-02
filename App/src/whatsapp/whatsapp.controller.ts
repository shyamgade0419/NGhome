import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { SystemRole } from '@prisma/client';
import { WhatsappService } from './whatsapp.service';
import { WhatsappConnectionService } from './whatsapp-connection.service';
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

/**
 * A society's own WhatsApp: its number, its messages. Every route works on the society in the caller's token and
 * nothing in the request can name another society's session.
 */
@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly connection: WhatsappConnectionService,
  ) {}

  @Get('status')
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: "Is WhatsApp allowed for this society, is its own number connected, and what is waiting to be sent" })
  status(@SocietyId() societyId: string) {
    return this.whatsapp.status(societyId);
  }

  @Get('connection')
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: "This society's WhatsApp number: linked or not, and the QR code to scan while it is being linked" })
  connectionState(@SocietyId() societyId: string) {
    return this.connection.state(societyId);
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Start linking this society's own WhatsApp number: creates its session and starts it, so a QR code appears" })
  connect(@SocietyId() societyId: string) {
    return this.connection.connect(societyId);
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Unlink this society's WhatsApp number" })
  disconnect(@SocietyId() societyId: string) {
    return this.connection.disconnect(societyId);
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
  @ApiOperation({ summary: "Send one test message to a number, from this society's own WhatsApp, to prove the connection works" })
  test(@SocietyId() societyId: string, @Body() dto: TestWhatsappDto) {
    return this.whatsapp.sendTest(societyId, dto.phone);
  }
}
