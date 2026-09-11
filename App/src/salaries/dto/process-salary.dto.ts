import {
  IsString, IsOptional, IsNumber, IsPositive, Min, Max, IsInt, IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A class, not an interface — see CreateEmployeeDto in this same directory
 * for why that matters. Every field is money, a month/year, or free text;
 * an un-validated month like 13 or a negative baseSalary override reached
 * processSalary()'s netSalary computation unchecked before this.
 */
export class ProcessSalaryDto {
  @ApiProperty()
  @IsString()
  employeeId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(12)
  salaryMonth: number;

  @ApiProperty()
  @IsInt()
  @Min(2000)
  @Max(2100)
  salaryYear: number;

  /** Overrides the employee's own baseSalary for this one month, if given. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @IsPositive({ message: 'baseSalary must be greater than zero' })
  baseSalary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  additions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  deductions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  /** Line-item breakdown (e.g. { "Bonus": 2000 }) — stored as-is, only its
   *  shape (a plain object, not a string/array/etc.) is checked here. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  additionsDetail?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  deductionsDetail?: Record<string, number>;
}
