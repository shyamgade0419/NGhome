import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { FlatDiscountsService } from './flat-discounts.service';
import { CreateFlatDiscountDto, UpdateFlatDiscountDto } from './dto/flat-discount.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
@Controller('billing/flat-discounts')
export class FlatDiscountsController {
  constructor(private readonly service: FlatDiscountsService) {}

  @Get()
  @ApiOperation({ summary: 'Standing discounts for flats, with whether each is in force' })
  list(@SocietyId() societyId: string) {
    return this.service.list(societyId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a standing discount to a flat: a fixed amount or a percentage off, from a date to a date' })
  create(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFlatDiscountDto) {
    return this.service.create(societyId, user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a standing discount, or switch it off' })
  update(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFlatDiscountDto,
  ) {
    return this.service.update(societyId, user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a standing discount' })
  remove(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.remove(societyId, user.id, id);
  }
}
