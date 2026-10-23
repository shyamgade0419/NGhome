import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AmenityBookingStatus, SystemRole } from '@prisma/client';
import { AmenitiesService } from './amenities.service';
import { CreateAmenityDto, UpdateAmenityDto } from './dto/amenity.dto';
import { CollectFeeDto, CreateBookingDto, RejectBookingDto } from './dto/booking.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

const COMMITTEE = [SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER] as const;

function isCommittee(user: AuthenticatedUser): boolean {
  return !!user.currentRole && (COMMITTEE as readonly SystemRole[]).includes(user.currentRole);
}

@ApiTags('Amenities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('amenities')
export class AmenitiesController {
  constructor(private readonly service: AmenitiesService) {}

  @Get()
  @ApiOperation({ summary: 'List bookable amenities — committee may include inactive ones with ?all=true' })
  @ApiQuery({ name: 'all', required: false })
  list(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Query('all') all?: string) {
    return this.service.listAmenities(societyId, isCommittee(user) && all === 'true');
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'Create an amenity' })
  create(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAmenityDto) {
    return this.service.createAmenity(societyId, dto, user.id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'Edit an amenity — applies to new bookings only' })
  update(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAmenityDto,
  ) {
    return this.service.updateAmenity(societyId, id, dto, user.id);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Slots for one day, with how many places remain in each' })
  @ApiQuery({ name: 'date', required: true, description: 'YYYY-MM-DD, in India time' })
  availability(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('date') date?: string,
  ) {
    if (!date) throw new BadRequestException('date is required, like 2026-11-04.');
    return this.service.getAvailability(societyId, id, date, user.flatId);
  }
}

@ApiTags('Amenity bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('amenity-bookings')
export class AmenityBookingsController {
  constructor(private readonly service: AmenitiesService) {}

  @Post()
  @ApiOperation({ summary: "Book a slot for the caller's own flat" })
  book(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBookingDto) {
    return this.service.book(societyId, user, dto);
  }

  // Declared before the ':id' routes below so "my" is never read as an id.
  @Get('my')
  @ApiOperation({ summary: "Bookings held by the caller's flat" })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  mine(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.service.myBookings(societyId, user, +page, +limit);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'All bookings in the society' })
  @ApiQuery({ name: 'status', required: false, enum: AmenityBookingStatus })
  @ApiQuery({ name: 'amenityId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  all(
    @SocietyId() societyId: string,
    @Query('status') status?: AmenityBookingStatus,
    @Query('amenityId') amenityId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.service.listBookings(societyId, { status, amenityId, page: +page, limit: +limit });
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: "Cancel a booking — a resident only their own flat's, and only within the cancellation window" })
  cancel(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancel(societyId, user, id, isCommittee(user));
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'Approve a pending booking request' })
  approve(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.approve(societyId, id, user.id);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'Decline a pending booking request' })
  reject(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectBookingDto,
  ) {
    return this.service.reject(societyId, id, user.id, dto.reason);
  }

  @Post(':id/fee/collect')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Record that the fee was received into a society account' })
  collectFee(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CollectFeeDto,
  ) {
    return this.service.collectFee(societyId, id, dto.accountId, user.id);
  }

  @Post(':id/fee/waive')
  @UseGuards(RolesGuard)
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'Waive a fee that is due' })
  waiveFee(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.waiveFee(societyId, id, user.id);
  }
}
