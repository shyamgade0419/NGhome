import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ParcelStatus, SystemRole } from '@prisma/client';
import { DeliveriesService } from './deliveries.service';
import { CreateExpectationDto, HandOverParcelDto, ReceiveParcelDto } from './dto/delivery.dto';
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

function parseParcelStatus(value: string | undefined): ParcelStatus | undefined {
  if (value === undefined || value === '') return undefined;
  if (!Object.values(ParcelStatus).includes(value as ParcelStatus)) throw new BadRequestException('status is not a valid value.');
  return value as ParcelStatus;
}

function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${name} must be a positive whole number.`);
  return n;
}

// ─── Resident: "a delivery is coming" ────────────────────────────────────────

@ApiTags('Deliveries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('delivery-expectations')
export class DeliveryExpectationsController {
  constructor(private readonly service: DeliveriesService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Tell the gate a delivery is coming: let it up, or leave it at the gate' })
  create(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpectationDto) {
    return this.service.createExpectation(societyId, user, dto);
  }

  @Get('my')
  @ApiOperation({ summary: "My flat's delivery instructions" })
  mine(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.myExpectations(societyId, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an instruction made from my flat' })
  cancel(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancelExpectation(societyId, user, id);
  }
}

// ─── Resident and committee: parcels ─────────────────────────────────────────

@ApiTags('Deliveries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('parcels')
export class ParcelsController {
  constructor(private readonly service: DeliveriesService) {}

  @Get('my')
  @ApiOperation({ summary: 'Parcels the gate holds or held for my flat, newest first' })
  @ApiQuery({ name: 'status', required: false })
  mine(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.service.myParcels(societyId, user, parseParcelStatus(status));
  }

  @Get()
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'Parcel log with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD (India time)' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD (India time), inclusive' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'flatId', required: false })
  @ApiQuery({ name: 'search', required: false })
  log(
    @SocietyId() societyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('flatId') flatId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.adminLog(societyId, {
      page: parsePositiveInt(page, 'page'),
      limit: Math.min(parsePositiveInt(limit, 'limit') ?? 25, 100),
      from,
      to,
      status: parseParcelStatus(status),
      flatId,
      search,
    });
  }
}

// ─── Gate ────────────────────────────────────────────────────────────────────

@ApiTags('Gate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...GATE)
@Controller('gate')
export class GateDeliveriesController {
  constructor(private readonly service: DeliveriesService) {}

  @Get('deliveries/expected')
  @ApiOperation({ summary: 'What residents said about deliveries that are still live' })
  expected(@SocietyId() societyId: string) {
    return this.service.gateExpected(societyId);
  }

  @Post('parcels')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Record a parcel left at the gate (safe to retry with the same clientRequestId)' })
  receive(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: ReceiveParcelDto) {
    return this.service.receiveParcel(societyId, user, dto);
  }

  @Get('parcels')
  @ApiOperation({ summary: 'Parcels still held, and anything closed today' })
  @ApiQuery({ name: 'search', required: false })
  list(@SocietyId() societyId: string, @Query('search') search?: string) {
    return this.service.gateParcels(societyId, search);
  }

  @Post('parcels/:id/hand-over')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hand a parcel to the person collecting it' })
  handOver(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: HandOverParcelDto) {
    return this.service.handOver(societyId, user, id, dto);
  }

  @Post('parcels/:id/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a parcel back to the courier' })
  returnToCourier(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.returnToCourier(societyId, user, id);
  }
}
