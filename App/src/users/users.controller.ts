import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { UserDeleteService } from './user-delete.service';
import { DeleteUserDto } from './dto/delete-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { AssignFlatDto } from './dto/assign-flat.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userDelete: UserDeleteService,
  ) {}

  @Get('society')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.SOCIETY_STAFF)
  @ApiOperation({ summary: 'Get all users in current society' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findBySociety(
    @SocietyId() societyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.usersService.findBySociety(societyId, +page, +limit);
  }

  // Registered before :id — a static segment declared after a param route
  // would otherwise be swallowed by it (Nest/Express match in declaration
  // order, not by specificity), the same reason 'society' above precedes it.
  @Get('directory')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Browse active residents/staff in the current society — name and flat only, never contact info' })
  @ApiQuery({ name: 'search', required: false, description: 'Matches first name, last name, or flat code' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getDirectory(
    @SocietyId() societyId: string,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.usersService.getDirectory(societyId, search, +page, +limit);
  }

  @Get(':id')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Get user by ID (society-scoped)' })
  async findOne(@Param('id') id: string, @SocietyId() societyId: string) {
    return this.usersService.findOne(id, societyId);
  }

  @Post('society/add-member')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Add an existing user to the current society' })
  async addMember(
    @SocietyId() societyId: string,
    @Body() body: AddMemberDto,
  ) {
    return this.usersService.addToSociety(
      societyId,
      body.userId,
      body.flatId,
      body.role,
      body.isPrimary ?? false,
    );
  }

  @Patch('society/:userId/flat')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Give a member who has no flat (e.g. an admin) a flat — updates their one membership' })
  async assignFlat(
    @SocietyId() societyId: string,
    @Param('userId') userId: string,
    @Body() dto: AssignFlatDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.assignFlat(societyId, userId, dto.flatId, actor.id);
  }

  @Delete('society/:userId/remove')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove user from current society' })
  async removeMember(@SocietyId() societyId: string, @Param('userId') userId: string) {
    await this.usersService.removeFromSociety(societyId, userId);
  }

  @Get('society/removed')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'People removed from this society whose accounts still exist' })
  async listRemoved(@SocietyId() societyId: string) {
    return this.usersService.listRemovedMembers(societyId);
  }

  @Get('society/:userId/deletion-preview')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'What deleting this member’s account would remove, and anything that stops it' })
  async deletionPreview(
    @SocietyId() societyId: string,
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.userDelete.preview(userId, actor.id, { societyId });
  }

  // POST rather than DELETE: the confirmation email travels in the body, and
  // the web proxy forwards DELETE without one.
  @Post('society/:userId/delete')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Permanently delete a member’s account (cannot be undone)' })
  async deleteMember(
    @SocietyId() societyId: string,
    @Param('userId') userId: string,
    @Body() dto: DeleteUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.userDelete.deleteUser(userId, dto.confirmEmail, actor.id, { societyId });
  }

  @Get('society/pending')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'List join requests awaiting approval (flat already had an active resident)' })
  async listPending(@SocietyId() societyId: string) {
    return this.usersService.listPendingMemberships(societyId);
  }

  @Post('society/pending/:membershipId/approve')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Approve a pending join request, granting active resident access' })
  async approvePending(
    @SocietyId() societyId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.approveMembership(societyId, membershipId, actor.id);
  }

  @Post('society/pending/:membershipId/reject')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reject a pending join request' })
  async rejectPending(
    @SocietyId() societyId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.usersService.rejectMembership(societyId, membershipId, actor.id);
  }

  @Patch(':id')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Update user profile' })
  async update(
    @Param('id') id: string,
    @SocietyId() societyId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, societyId, dto);
  }
}
