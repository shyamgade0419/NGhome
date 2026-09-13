import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { ForumService } from './forum.service';
import { CreateForumTopicDto } from './dto/create-forum-topic.dto';
import { CreateForumReplyDto } from './dto/create-forum-reply.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

const MODERATOR_ROLES: SystemRole[] = [SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER];

@ApiTags('Forum')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('forum')
export class ForumController {
  constructor(private readonly forumService: ForumService) {}

  @Post('topics')
  @ApiOperation({ summary: 'Start a new discussion topic — any active member of the society' })
  createTopic(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateForumTopicDto,
  ) {
    return this.forumService.createTopic(societyId, user.id, dto);
  }

  @Get('topics')
  @ApiOperation({ summary: 'List discussion topics — pinned first, then newest' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  findAll(
    @SocietyId() societyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.forumService.findAll(societyId, +page, +limit);
  }

  @Get('topics/:id')
  @ApiOperation({ summary: 'Get a topic and its replies' })
  findOne(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.forumService.findOne(societyId, id);
  }

  @Post('topics/:id/replies')
  @ApiOperation({ summary: 'Reply to a topic — any active member, unless the topic is locked' })
  addReply(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateForumReplyDto,
  ) {
    return this.forumService.addReply(societyId, id, user.id, dto);
  }

  @Patch('topics/:id/pin')
  @UseGuards(RolesGuard)
  @Roles(...MODERATOR_ROLES)
  @ApiOperation({ summary: 'Pin a topic to the top of the list' })
  pin(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.forumService.setPinned(societyId, id, true);
  }

  @Patch('topics/:id/unpin')
  @UseGuards(RolesGuard)
  @Roles(...MODERATOR_ROLES)
  @ApiOperation({ summary: 'Unpin a topic' })
  unpin(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.forumService.setPinned(societyId, id, false);
  }

  @Patch('topics/:id/lock')
  @UseGuards(RolesGuard)
  @Roles(...MODERATOR_ROLES)
  @ApiOperation({ summary: 'Lock a topic — no further replies until unlocked' })
  lock(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.forumService.setLocked(societyId, id, true);
  }

  @Patch('topics/:id/unlock')
  @UseGuards(RolesGuard)
  @Roles(...MODERATOR_ROLES)
  @ApiOperation({ summary: 'Unlock a topic' })
  unlock(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.forumService.setLocked(societyId, id, false);
  }

  @Delete('topics/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a topic — its own author, or an admin/committee member moderating' })
  async remove(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.forumService.remove(societyId, id, {
      id: user.id,
      isModerator: MODERATOR_ROLES.includes(user.currentRole as SystemRole),
    });
  }
}
