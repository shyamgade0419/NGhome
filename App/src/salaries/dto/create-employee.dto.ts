import {
  IsString, IsOptional, IsNumber, IsPositive, IsEmail, IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

/**
 * A class, not an interface — SalariesService used to take these as plain
 * TypeScript interfaces, which Nest sees as Object at runtime and the
 * global ValidationPipe skips entirely. baseSalary is money; NaN,
 * Infinity, or a negative value all reached processSalary()'s netSalary
 * arithmetic unchecked (see also the CreateExpenseDto -5000 story this
 * pattern already fixed elsewhere in the codebase).
 */
export class CreateEmployeeDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  designation: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  joinDate?: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive({ message: 'baseSalary must be greater than zero' })
  baseSalary: number;
}

/** Same fields, all optional, same validators — see UpdateExpenseDto for why
 *  this can't just be `Partial<CreateEmployeeDto>`. */
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}
