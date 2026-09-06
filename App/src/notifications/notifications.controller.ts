import { Controller, Get, Post, Delete, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { NotificationsService, SendNotificationDto } from './notifications.service';
import { PushService } from './push.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

// TenantGuard is deliberately NOT a class-level guard here (it used to be,
// covering every route below) — push-token registration has to work for
// an authenticated user with no society context yet (mid multi-society
// selection, or a platform admin), and none of findMine/unreadCount/
// markRead/push-token actually use @SocietyId() or take a societyId
// param; only send() does, so only send() asks for TenantGuard.
@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  @Post()
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_STAFF)
  @ApiOperation({ summary: 'Send a notification to society members' })
  send(@SocietyId() societyId: string, @Body() dto: SendNotificationDto) {
    return this.notificationsService.send(societyId, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get own notifications' })
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.notificationsService.findMyNotifications(user.id, +page, +limit);
  }

  @Get('my/unread-count')
  @ApiOperation({ summary: 'Count of unread notifications — powers the bell-icon badge' })
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Patch('my/:id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notificationsService.markRead(user.id, id);
  }

  @Post('push-token')
  @ApiOperation({ summary: 'Register this device for push notifications' })
  registerPushToken(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterPushTokenDto) {
    return this.pushService.registerToken(user.id, dto.token, dto.platform);
  }

  @Delete('push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unregister this device (called on logout) so it stops receiving push notifications' })
  async unregisterPushToken(@Body() dto: RegisterPushTokenDto) {
    await this.pushService.unregisterToken(dto.token);
  }
}
