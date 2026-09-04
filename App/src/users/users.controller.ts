import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
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
  constructor(private readonly usersService: UsersService) {}

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
    @Body() body: { userId: string; flatId?: string; role: SystemRole; isPrimary?: boolean },
  ) {
    return this.usersService.addToSociety(
      societyId,
      body.userId,
      body.flatId,
      body.role,
      body.isPrimary ?? false,
    );
  }

  @Delete('society/:userId/remove')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove user from current society' })
  async removeMember(@SocietyId() societyId: string, @Param('userId') userId: string) {
    await this.usersService.removeFromSociety(societyId, userId);
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
