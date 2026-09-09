import {
  IsString, IsOptional, IsNumber, IsBoolean, IsDateString, IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

/**
 * A class, not an interface, so the global ValidationPipe actually runs.
 *
 * While this was an interface, Nest saw the parameter type as Object and
 * skipped validation entirely: `amount: -5000` was accepted, and marking that
 * expense paid ran `decrement: -5000` — increasing the bank balance by five
 * thousand rupees. Nothing anywhere else guarded it.
 *
 * The same gap is why `category` was silently dropped for so long: with no
 * validatable class, forbidNonWhitelisted never fired, so an unknown field
 * passed straight through instead of erroring.
 *
 * Every field both clients send is declared here on purpose. Now that
 * validation applies, forbidNonWhitelisted rejects anything not listed, so an
 * omission here would turn into a 400 on a form that used to work.
 */
export class CreateExpenseDto {
  @ApiProperty()
  @IsString()
  description: string;

  /**
   * Web posts this as a string (its form regex validates the text), mobile as
   * a number. The pipe's enableImplicitConversion coerces the string before
   * @IsNumber sees it, so both are accepted.
   */
  @ApiProperty()
  @IsNumber()
  @IsPositive({ message: 'amount must be greater than zero' })
  amount: number;

  /** Category by name — resolved to a real ExpenseCategory in the service. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  /** Only for callers that already hold a category id; takes precedence. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty()
  @IsDateString()
  expenseDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorPayee?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;
}

/** Same fields, all optional, same validators — so PATCH is validated too.
 *  `Partial<CreateXDto>` would not be: a mapped type erases to Object at
 *  runtime and Nest skips validation entirely. */
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
