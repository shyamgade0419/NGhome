/**
 * These DTOs were plain interfaces, so Nest saw the body parameter as Object
 * and skipped validation entirely: POST /expenses accepted `amount: -5000`,
 * and marking that expense paid ran `decrement: -5000` — raising the bank
 * balance by five thousand rupees. Nothing else guarded it.
 *
 * Converting them to classes also switches on forbidNonWhitelisted for these
 * routes, which is the risk worth testing: a field the apps really send but
 * the class forgot would turn a working form into a 400. Each payload below
 * is the exact shape the shipped clients post.
 */

import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CreateExpenseDto } from '../expenses/dto/create-expense.dto';
import { CreateAccountDto } from '../accounts/dto/create-account.dto';
import { CreateFundDto } from '../funds/dto/create-fund.dto';
import { CreateEventDto } from '../events/dto/create-event.dto';
import { SubmitPaymentDto } from '../payments/dto/submit-payment.dto';
import { CreateEmployeeDto } from '../salaries/dto/create-employee.dto';
import { ProcessSalaryDto } from '../salaries/dto/process-salary.dto';

// Mirrors main.ts exactly — testing against different settings proves nothing.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const run = (value: unknown, metatype: any) =>
  pipe.transform(value, { type: 'body', metatype });

describe('Money DTO validation', () => {
  describe('CreateExpenseDto', () => {
    it('accepts the payload mobile actually sends', async () => {
      await expect(
        run(
          {
            description: 'Plumber repair work',
            amount: 2500,
            category: 'MAINTENANCE',
            expenseDate: '2026-09-09',
            vendorPayee: 'Ramesh Plumbing',
            notes: 'Tap leak, B wing',
          },
          CreateExpenseDto,
        ),
      ).resolves.toMatchObject({ amount: 2500, category: 'MAINTENANCE' });
    });

    it('accepts web sending amount as a string', async () => {
      // Web's form validates the text with a regex and posts it as-is.
      const out: any = await run(
        { description: 'Housekeeping', amount: '1800.50', category: 'HOUSEKEEPING', expenseDate: '2026-09-09' },
        CreateExpenseDto,
      );
      expect(out.amount).toBe(1800.5);
    });

    it('rejects a negative amount', async () => {
      await expect(
        run({ description: 'Oops', amount: -5000, expenseDate: '2026-09-09' }, CreateExpenseDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects zero', async () => {
      await expect(
        run({ description: 'Nothing', amount: 0, expenseDate: '2026-09-09' }, CreateExpenseDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('CreateAccountDto', () => {
    it('accepts the payload the new account form sends', async () => {
      await expect(
        run(
          {
            name: 'HDFC Current A/c',
            accountType: 'CURRENT',
            bankName: 'HDFC Bank',
            accountNumberMasked: 'XXXX4321',
            ifscCode: 'HDFC0001234',
            openingBalance: 125000,
          },
          CreateAccountDto,
        ),
      ).resolves.toMatchObject({ accountType: 'CURRENT' });
    });

    it('accepts a cash account with no bank fields', async () => {
      await expect(
        run({ name: 'Petty Cash', accountType: 'CASH' }, CreateAccountDto),
      ).resolves.toMatchObject({ name: 'Petty Cash' });
    });

    it('rejects an account type that is not a real one', async () => {
      await expect(
        run({ name: 'Crypto', accountType: 'BITCOIN' }, CreateAccountDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a negative opening balance', async () => {
      await expect(
        run({ name: 'X', accountType: 'CASH', openingBalance: -100 }, CreateAccountDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('CreateFundDto', () => {
    it('accepts the payload the new fund form sends', async () => {
      await expect(
        run(
          { name: 'Corpus Fund', description: 'Long-term reserve', openingBalance: 500000, isVisibleToResidents: false },
          CreateFundDto,
        ),
      ).resolves.toMatchObject({ name: 'Corpus Fund' });
    });

    it('rejects a negative opening balance', async () => {
      await expect(
        run({ name: 'Corpus Fund', openingBalance: -1 }, CreateFundDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('CreateEventDto', () => {
    it('accepts the payload the mobile event form sends, including a null fund', async () => {
      await expect(
        run(
          {
            title: 'Diwali Celebration',
            description: 'Common area decoration',
            eventDate: '2026-10-20T00:00:00.000Z',
            fundId: null,
            estimatedCost: 25000,
            actualCost: 24000,
            status: 'PLANNED',
            isVisibleToResidents: true,
          },
          CreateEventDto,
        ),
      ).resolves.toMatchObject({ title: 'Diwali Celebration' });
    });

    it('rejects a negative actual cost', async () => {
      // recordExpense would otherwise turn this into an expense that *raised*
      // the linked fund's balance.
      await expect(
        run({ title: 'X', eventDate: '2026-10-20T00:00:00.000Z', actualCost: -5000 }, CreateEventDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown field rather than silently dropping it', async () => {
      // This is how the expense category went missing for so long.
      await expect(
        run({ title: 'X', eventDate: '2026-10-20T00:00:00.000Z', totallyMadeUp: 'value' }, CreateEventDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('SubmitPaymentDto', () => {
    const valid = { amount: 2500, paymentDate: '2026-09-09', paymentMethod: 'UPI' };

    it('accepts the payload the apps actually send', async () => {
      await expect(run(valid, SubmitPaymentDto)).resolves.toMatchObject({ amount: 2500 });
    });

    it('rejects a ₹0 payment', async () => {
      await expect(run({ ...valid, amount: 0 }, SubmitPaymentDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a negative payment', async () => {
      await expect(run({ ...valid, amount: -500 }, SubmitPaymentDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('CreateEmployeeDto — was a plain interface, so ValidationPipe skipped it entirely', () => {
    const valid = { name: 'Ramesh Kumar', designation: 'Security Guard', baseSalary: 18000 };

    it('accepts a normal employee payload', async () => {
      await expect(run(valid, CreateEmployeeDto)).resolves.toMatchObject({ name: 'Ramesh Kumar' });
    });

    it('rejects a negative baseSalary', async () => {
      await expect(run({ ...valid, baseSalary: -18000 }, CreateEmployeeDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects NaN as baseSalary', async () => {
      await expect(run({ ...valid, baseSalary: NaN }, CreateEmployeeDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a malformed email', async () => {
      await expect(run({ ...valid, email: 'not-an-email' }, CreateEmployeeDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a malformed joinDate', async () => {
      await expect(run({ ...valid, joinDate: 'not-a-date' }, CreateEmployeeDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('ProcessSalaryDto — was a plain interface, so ValidationPipe skipped it entirely', () => {
    const valid = { employeeId: 'employee-1', salaryMonth: 9, salaryYear: 2026 };

    it('accepts a normal process-salary payload', async () => {
      await expect(run(valid, ProcessSalaryDto)).resolves.toMatchObject({ salaryMonth: 9, salaryYear: 2026 });
    });

    it.each([0, 13, -1, 1.5])('rejects an invalid salaryMonth (%j)', async (salaryMonth) => {
      await expect(run({ ...valid, salaryMonth }, ProcessSalaryDto)).rejects.toThrow(BadRequestException);
    });

    it.each([1999, 2101])('rejects an out-of-range salaryYear (%j)', async (salaryYear) => {
      await expect(run({ ...valid, salaryYear }, ProcessSalaryDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a negative baseSalary override', async () => {
      await expect(run({ ...valid, baseSalary: -5000 }, ProcessSalaryDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a negative additions/deductions value', async () => {
      await expect(run({ ...valid, additions: -100 }, ProcessSalaryDto)).rejects.toThrow(BadRequestException);
      await expect(run({ ...valid, deductions: -100 }, ProcessSalaryDto)).rejects.toThrow(BadRequestException);
    });

    it('accepts an additionsDetail/deductionsDetail line-item breakdown', async () => {
      await expect(
        run({ ...valid, additionsDetail: { Bonus: 2000 }, deductionsDetail: { PF: 500 } }, ProcessSalaryDto),
      ).resolves.toMatchObject({ additionsDetail: { Bonus: 2000 } });
    });

    it('rejects additionsDetail that is not an object', async () => {
      await expect(run({ ...valid, additionsDetail: 'not-an-object' }, ProcessSalaryDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown field rather than silently dropping it', async () => {
      await expect(run({ ...valid, totallyMadeUp: 'value' }, ProcessSalaryDto)).rejects.toThrow(BadRequestException);
    });
  });
});
