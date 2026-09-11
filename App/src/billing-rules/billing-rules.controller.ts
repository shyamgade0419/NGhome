import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { BillingRulesService } from './billing-rules.service';
import { CreateBillingRuleDto } from './dto/create-billing-rule.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';

@ApiTags('Billing Rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('billing-rules')
export class BillingRulesController {
  constructor(private readonly billingRulesService: BillingRulesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Create a billing rule' })
  create(@SocietyId() societyId: string, @Body() dto: CreateBillingRuleDto) {
    return this.billingRulesService.create(societyId, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'List all billing rules' })
  findAll(@SocietyId() societyId: string) {
    return this.billingRulesService.findAll(societyId);
  }

  @Get('active')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Get currently active billing rules' })
  findActive(@SocietyId() societyId: string) {
    return this.billingRulesService.findActive(societyId);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Get billing rule by ID' })
  findOne(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.billingRulesService.findOne(societyId, id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Update a billing rule' })
  update(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateBillingRuleDto>,
  ) {
    return this.billingRulesService.update(societyId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a billing rule' })
  async remove(@SocietyId() societyId: string, @Param('id') id: string) {
    await this.billingRulesService.remove(societyId, id);
  }

  @Patch(':id/toggle')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Activate or deactivate a billing rule' })
  toggle(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.billingRulesService.setActive(societyId, id, isActive);
  }
}
