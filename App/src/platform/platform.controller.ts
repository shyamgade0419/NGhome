import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PlatformService } from './platform.service';
import { PlatformMailService } from './platform-mail.service';
import { UserDeleteService } from '../users/user-delete.service';
import { DeleteUserDto } from '../users/dto/delete-user.dto';
import { SetAdminStatusDto } from './dto/set-admin-status.dto';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { InvitePlatformAdminDto } from './dto/invite-platform-admin.dto';

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly platformMail: PlatformMailService,
    private readonly userDelete: UserDeleteService,
  ) {}

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

  // Logs in to the mail server and sends a real message to the admin asking, so
  // it is throttled like the storage check.
  @Post('mail/check')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '[Platform Admin] Check the email setup: log in to SMTP and send a test message to yourself' })
  checkMail(@CurrentUser() user: AuthenticatedUser) {
    return this.platformMail.check(user.id);
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

  @Post('admins')
  @ApiOperation({ summary: '[Platform Admin] Invite a new platform admin — they set their own password by email' })
  inviteAdmin(@Body() dto: InvitePlatformAdminDto, @CurrentUser() user: AuthenticatedUser) {
    return this.platform.inviteAdmin(dto, user.id);
  }

  @Post('admins/:id/resend-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Platform Admin] Re-send the set-your-password email to an admin who has not signed in yet' })
  resendInvite(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.platform.resendInvite(id, user.id);
  }

  @Get('users/:id/deletion-preview')
  @ApiOperation({ summary: '[Platform Admin] What deleting this account would remove, and what stops it' })
  deletionPreview(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.userDelete.preview(id, user.id);
  }

  // POST rather than DELETE: the confirmation email travels in the body, and
  // the web proxy forwards DELETE without one.
  @Post('users/:id/delete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '[Platform Admin] Permanently delete an account (cannot be undone)' })
  deleteUser(@Param('id') id: string, @Body() dto: DeleteUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.userDelete.deleteUser(id, dto.confirmEmail, user.id);
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
