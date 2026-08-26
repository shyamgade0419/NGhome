import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { SalariesService, CreateEmployeeDto, ProcessSalaryDto } from './salaries.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Salaries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
@Controller('salaries')
export class SalariesController {
  constructor(private readonly salariesService: SalariesService) {}

  @Post('employees')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Add a society employee' })
  createEmployee(@SocietyId() societyId: string, @Body() dto: CreateEmployeeDto) {
    return this.salariesService.createEmployee(societyId, dto);
  }

  @Get('employees')
  @ApiOperation({ summary: 'List all employees' })
  findEmployees(@SocietyId() societyId: string) {
    return this.salariesService.findEmployees(societyId);
  }

  @Post('process')
  @ApiOperation({ summary: 'Process salary for an employee' })
  processSalary(@SocietyId() societyId: string, @Body() dto: ProcessSalaryDto) {
    return this.salariesService.processSalary(societyId, dto);
  }

  @Post(':id/pay')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Mark salary as paid and debit account' })
  paySalary(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.salariesService.paySalary(societyId, id, user.id);
  }

  @Get('records')
  @ApiOperation({ summary: 'Get salary records, optionally filtered by month/year' })
  findRecords(
    @SocietyId() societyId: string,
    @Query('month') month?: number,
    @Query('year') year?: number,
  ) {
    return this.salariesService.findSalaryRecords(societyId, month ? +month : undefined, year ? +year : undefined);
  }
}
