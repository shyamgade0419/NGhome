import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
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
import { UpdateMailSettingsDto } from './dto/update-mail-settings.dto';
import { MailSettingsStore } from '../mail/mail-settings.store';
import { WhatsappSettingsStore } from '../whatsapp/whatsapp-settings.store';
import { WhatsappConnectionService } from '../whatsapp/whatsapp-connection.service';
import { UpdateWhatsappSettingsDto } from './dto/update-whatsapp-settings.dto';
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
    private readonly mailSettings: MailSettingsStore,
    private readonly whatsappSettings: WhatsappSettingsStore,
    private readonly whatsappConnection: WhatsappConnectionService,
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

  // The mail login managed from the console. It wins over the SMTP_* environment
  // variables when saved; DELETE falls back to them. The password is never returned.
  @Get('mail/settings')
  @ApiOperation({ summary: '[Platform Admin] The saved mail login (never the password) and where mail is sent from now' })
  getMailSettings() {
    return this.mailSettings.view();
  }

  @Put('mail/settings')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '[Platform Admin] Save the mail login. A blank password keeps the saved one.' })
  saveMailSettings(@Body() dto: UpdateMailSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.mailSettings.save(dto, user.id);
  }

  @Delete('mail/settings')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '[Platform Admin] Forget the saved mail login and go back to the SMTP_* environment variables' })
  clearMailSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.mailSettings.clear(user.id);
  }

  // The WhatsApp gateway (OpenWA) connection managed from the console. It wins over the WHATSAPP_* environment
  // variables, so WhatsApp can be set up, and its phone linked, without touching the server.
  @Get('whatsapp/settings')
  @ApiOperation({ summary: '[Platform Admin] The saved WhatsApp gateway address (never the key) and where the connection comes from now' })
  getWhatsappSettings() {
    return this.whatsappSettings.view();
  }

  @Put('whatsapp/settings')
  @ApiOperation({ summary: '[Platform Admin] Save the WhatsApp gateway address and key. A blank key keeps the saved one.' })
  saveWhatsappSettings(@Body() dto: UpdateWhatsappSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.whatsappSettings.save(dto, user.id);
  }

  @Delete('whatsapp/settings')
  @ApiOperation({ summary: '[Platform Admin] Forget the saved gateway and go back to the WHATSAPP_* environment variables' })
  clearWhatsappSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.whatsappSettings.clear(user.id);
  }

  @Get('whatsapp/connection')
  @ApiOperation({ summary: '[Platform Admin] Is a phone linked, and the QR code to scan while one is being linked' })
  getWhatsappConnection() {
    return this.whatsappConnection.state();
  }

  @Post('whatsapp/connect')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '[Platform Admin] Start linking a phone: finds or creates the session and starts it' })
  connectWhatsapp(@CurrentUser() user: AuthenticatedUser) {
    return this.whatsappConnection.connect(user.id);
  }

  @Post('whatsapp/disconnect')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '[Platform Admin] Unlink the phone from the gateway' })
  disconnectWhatsapp() {
    return this.whatsappConnection.disconnect();
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
