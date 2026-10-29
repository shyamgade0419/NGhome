import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SystemRole } from '@prisma/client';
import { VehiclesService } from './vehicles.service';
import { AddVehicleDto, AllocateSlotDto, AssignVehicleDto, BulkSlotsDto, CommitteeRemoveVehicleDto, CreateSlotDto, RemoveVehicleDto } from './dto/vehicle.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

const COMMITTEE = [SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER] as const;
/** Who may work the gate. The committee is included so a society without a guard can still use it. */
const GATE = [SystemRole.SECURITY_GUARD, SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER] as const;

function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${name} must be a positive whole number.`);
  return n;
}

// ─── Resident: my vehicles; committee: the register ──────────────────────────

@ApiTags('Vehicles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly service: VehiclesService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a vehicle for my flat' })
  add(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: AddVehicleDto) {
    return this.service.addVehicle(societyId, user, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Vehicles registered to my flat' })
  mine(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.myVehicles(societyId, user);
  }

  @Get()
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'The society vehicle register' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Plate, flat number or make' })
  @ApiQuery({ name: 'flatId', required: false })
  @ApiQuery({ name: 'removed', required: false, description: 'true lists removed vehicles instead' })
  register(
    @SocietyId() societyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('flatId') flatId?: string,
    @Query('removed') removed?: string,
  ) {
    return this.service.adminVehicles(societyId, {
      page: parsePositiveInt(page, 'page'),
      limit: Math.min(parsePositiveInt(limit, 'limit') ?? 25, 100),
      search,
      flatId,
      removed: removed === 'true',
    });
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a vehicle off my flat list (frees its plate and slot)' })
  remove(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RemoveVehicleDto) {
    return this.service.removeVehicle(societyId, user, id, dto.reason);
  }

  @Post(':id/deactivate')
  @Roles(...COMMITTEE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Committee removes a vehicle record, with a reason' })
  deactivate(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CommitteeRemoveVehicleDto) {
    return this.service.committeeRemoveVehicle(societyId, user, id, dto.reason);
  }
}

// ─── Resident: my parking ────────────────────────────────────────────────────

@ApiTags('Parking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('parking')
export class ParkingController {
  constructor(private readonly service: VehiclesService) {}

  @Get('my')
  @ApiOperation({ summary: 'Slots allocated to my flat' })
  mine(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.myParking(societyId, user);
  }

  @Post(':id/assign-vehicle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Say which of my vehicles uses one of my slots (null clears it)' })
  assign(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignVehicleDto) {
    return this.service.assignVehicle(societyId, user, id, dto);
  }
}

// ─── Committee: parking slots ────────────────────────────────────────────────

@ApiTags('Parking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...COMMITTEE)
@Controller('parking-slots')
export class ParkingSlotsController {
  constructor(private readonly service: VehiclesService) {}

  @Get()
  @ApiOperation({ summary: 'All parking slots, with who holds each' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['FREE', 'ALLOCATED', 'VISITOR'] })
  @ApiQuery({ name: 'flatId', required: false })
  list(
    @SocietyId() societyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('flatId') flatId?: string,
  ) {
    if (status && !['FREE', 'ALLOCATED', 'VISITOR'].includes(status)) throw new BadRequestException('status is not a valid value.');
    return this.service.adminSlots(societyId, {
      page: parsePositiveInt(page, 'page'),
      limit: Math.min(parsePositiveInt(limit, 'limit') ?? 50, 200),
      search,
      status: status as 'FREE' | 'ALLOCATED' | 'VISITOR' | undefined,
      flatId,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Add one parking slot' })
  create(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSlotDto) {
    return this.service.createSlot(societyId, user, dto);
  }

  @Post('bulk')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Add a block of slots (prefix + a number range), all or none' })
  bulk(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: BulkSlotsDto) {
    return this.service.bulkCreateSlots(societyId, user, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a slot nobody holds' })
  remove(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.deleteSlot(societyId, user, id);
  }

  @Post(':id/allocate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Give a free slot to a flat' })
  allocate(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AllocateSlotDto) {
    return this.service.allocate(societyId, user, id, dto);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a slot back from its flat' })
  release(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.release(societyId, user, id);
  }
}

// ─── Gate ────────────────────────────────────────────────────────────────────

@ApiTags('Gate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...GATE)
@Controller('gate')
export class GateVehiclesController {
  constructor(private readonly service: VehiclesService) {}

  // Rate limited: a lookup answers "whose is this plate", so it should not be usable to sweep the register.
  @Get('vehicles/lookup')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @ApiOperation({ summary: 'Whose is this vehicle? Type 3 or more characters of the number (flat number and slot only)' })
  @ApiQuery({ name: 'search', required: true })
  lookup(@SocietyId() societyId: string, @Query('search') search?: string) {
    return this.service.lookup(societyId, search);
  }
}
