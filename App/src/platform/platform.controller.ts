import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PlatformService } from './platform.service';
import { SetAdminStatusDto } from './dto/set-admin-status.dto';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('storage')
  @ApiOperation({ summary: '[Platform Admin] File storage used per society' })
  storage() {
    return this.platform.getStorageOverview();
  }

  // Opens a real SFTP connection and writes a probe file, so it is throttled
  // the same way GET /health/storage is.
  @Post('storage/check')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: '[Platform Admin] Test the SFTP connection (connect + write)' })
  checkStorage() {
    return this.platform.checkStorageConnection();
  }

  @Get('settings')
  @ApiOperation({ summary: '[Platform Admin] Pricing mode and support-prompt settings' })
  settings() {
    return this.platform.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: '[Platform Admin] Update pricing mode and support-prompt settings' })
  updateSettings(@Body() dto: UpdatePlatformSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.platform.updateSettings(dto, user.id);
  }

  @Get('admins')
  @ApiOperation({ summary: '[Platform Admin] List platform admins' })
  admins() {
    return this.platform.listAdmins();
  }

  @Patch('admins/:id/status')
  @ApiOperation({ summary: '[Platform Admin] Activate or deactivate a platform admin' })
  setAdminStatus(
    @Param('id') id: string,
    @Body() dto: SetAdminStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.platform.setAdminActive(id, dto.isActive, user.id);
  }
}
