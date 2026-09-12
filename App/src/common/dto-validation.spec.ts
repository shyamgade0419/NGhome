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
import { AdjustBillDto } from '../billing/dto/adjust-bill.dto';
import { ApprovePaymentDto } from '../payments/dto/approve-payment.dto';
import { RejectPaymentDto } from '../payments/dto/reject-payment.dto';
import { RejectExpenseDto } from '../expenses/dto/reject-expense.dto';
import { MarkExpensePaidDto } from '../expenses/dto/mark-expense-paid.dto';
import { AddMemberDto } from '../users/dto/add-member.dto';
import { CreateAnnouncementDto } from '../announcements/dto/create-announcement.dto';
import { CreateMeetingDto } from '../meetings/dto/create-meeting.dto';
import { AddAttendeesDto } from '../meetings/dto/add-attendees.dto';
import { CreateDocumentDto } from '../documents/dto/create-document.dto';
import { CreateWaterConfigDto } from '../water/dto/create-water-config.dto';
import { RecordReadingDto } from '../water/dto/record-reading.dto';
import { AllocateWaterCostsDto } from '../water/dto/allocate-water-costs.dto';
import { SendNotificationDto } from '../notifications/dto/send-notification.dto';
import { SystemRole, AnnouncementPriority, WaterBillingModel, NotificationChannel } from '@prisma/client';

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

/**
 * These were plain `{ ... }` inline object types on admin/approval routes —
 * same invisible-to-ValidationPipe problem as the DTOs above, found by
 * auditing every other @Body() in the controllers for the same shape
 * (interfaces/object-literal types used directly as a DTO). The underlying
 * financial/tenancy safety for accountId fields was already enforced
 * server-side in each service (re-validated against the caller's own
 * society before any money moves) — what was missing was a clean 400 at
 * the API boundary instead of a malformed/missing field reaching the
 * service unchecked.
 */
describe('Admin action DTO validation', () => {
  describe('AdjustBillDto', () => {
    it('accepts a genuine adjustment', async () => {
      await expect(run({ adjustment: -500, note: 'Late fee waived' }, AdjustBillDto)).resolves.toMatchObject({
        adjustment: -500,
      });
    });

    it('rejects a non-numeric adjustment', async () => {
      await expect(run({ adjustment: 'a lot', note: 'x' }, AdjustBillDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing note', async () => {
      await expect(run({ adjustment: 100 }, AdjustBillDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('ApprovePaymentDto', () => {
    it('accepts the payload the apps send', async () => {
      await expect(
        run({ accountId: 'account-1', notes: 'Verified against bank statement' }, ApprovePaymentDto),
      ).resolves.toMatchObject({ accountId: 'account-1' });
    });

    it('rejects a missing accountId', async () => {
      await expect(run({ notes: 'x' }, ApprovePaymentDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('RejectPaymentDto / RejectExpenseDto', () => {
    it('accepts a genuine reason', async () => {
      await expect(run({ reason: 'Amount does not match bank statement' }, RejectPaymentDto)).resolves.toMatchObject({
        reason: expect.any(String),
      });
      await expect(run({ reason: 'Missing invoice' }, RejectExpenseDto)).resolves.toMatchObject({
        reason: expect.any(String),
      });
    });

    it('rejects an empty reason', async () => {
      await expect(run({ reason: '' }, RejectPaymentDto)).rejects.toThrow(BadRequestException);
      await expect(run({ reason: '' }, RejectExpenseDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('MarkExpensePaidDto', () => {
    it('accepts a genuine accountId', async () => {
      await expect(run({ accountId: 'account-1' }, MarkExpensePaidDto)).resolves.toMatchObject({
        accountId: 'account-1',
      });
    });

    it('rejects a missing accountId', async () => {
      await expect(run({}, MarkExpensePaidDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('AddMemberDto', () => {
    it('accepts the payload the admin UI sends', async () => {
      await expect(
        run({ userId: 'user-1', flatId: 'flat-1', role: SystemRole.RESIDENT, isPrimary: true }, AddMemberDto),
      ).resolves.toMatchObject({ role: SystemRole.RESIDENT });
    });

    it('accepts a role-only change with no flatId', async () => {
      await expect(run({ userId: 'user-1', role: SystemRole.SOCIETY_STAFF }, AddMemberDto)).resolves.toMatchObject({
        role: SystemRole.SOCIETY_STAFF,
      });
    });

    it('rejects a role outside the SystemRole enum — the exact bug class this closes', async () => {
      await expect(run({ userId: 'user-1', role: 'SUPER_ADMIN' }, AddMemberDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing role', async () => {
      await expect(run({ userId: 'user-1' }, AddMemberDto)).rejects.toThrow(BadRequestException);
    });
  });
});

/**
 * These four modules' DTOs were also plain interfaces — found by
 * mechanically auditing every remaining @Body()/service-parameter type in
 * the repo for the same shape, not just the financial/security-sensitive
 * ones fixed above. None carry money or a privilege assignment, but an
 * invalid enum/date still reached the database as an opaque error instead
 * of a clean 400, and AllocateWaterCostsDto's cost fields (municipal bill,
 * tanker cost, electricity %) had no numeric validation at all despite
 * feeding directly into a per-flat billing calculation.
 */
describe('Non-financial DTO validation (found via the full @Body() sweep)', () => {
  describe('CreateAnnouncementDto', () => {
    it('accepts a genuine announcement', async () => {
      await expect(
        run({ title: 'AGM Notice', content: 'The AGM will be held...', priority: AnnouncementPriority.HIGH }, CreateAnnouncementDto),
      ).resolves.toMatchObject({ title: 'AGM Notice' });
    });

    it('rejects a priority outside the enum', async () => {
      await expect(
        run({ title: 'x', content: 'y', priority: 'SUPER_URGENT' }, CreateAnnouncementDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a malformed publishAt', async () => {
      await expect(
        run({ title: 'x', content: 'y', publishAt: 'not-a-date' }, CreateAnnouncementDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('CreateMeetingDto', () => {
    it('accepts a genuine meeting', async () => {
      await expect(
        run({ title: 'Monthly Committee Meeting', meetingDate: '2026-10-01' }, CreateMeetingDto),
      ).resolves.toMatchObject({ title: 'Monthly Committee Meeting' });
    });

    it('rejects a malformed meetingDate', async () => {
      await expect(run({ title: 'x', meetingDate: 'next tuesday' }, CreateMeetingDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('AddAttendeesDto', () => {
    it('accepts a genuine attendee list', async () => {
      await expect(
        run({ attendees: [{ name: 'Ramesh Kumar', flatCode: 'A-101' }] }, AddAttendeesDto),
      ).resolves.toMatchObject({ attendees: [{ name: 'Ramesh Kumar' }] });
    });

    it('rejects an empty attendee list', async () => {
      await expect(run({ attendees: [] }, AddAttendeesDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects an attendee missing a name', async () => {
      await expect(run({ attendees: [{ flatCode: 'A-101' }] }, AddAttendeesDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('CreateDocumentDto', () => {
    const valid = { title: 'Fire safety certificate', fileName: 'cert.pdf', fileKey: 'https://example.com/cert.pdf', fileSize: 12345, mimeType: 'application/pdf' };

    it('accepts the payload the admin UI sends', async () => {
      await expect(run(valid, CreateDocumentDto)).resolves.toMatchObject({ title: valid.title });
    });

    it('rejects a blank title', async () => {
      await expect(run({ ...valid, title: '' }, CreateDocumentDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-integer fileSize', async () => {
      await expect(run({ ...valid, fileSize: 12.5 }, CreateDocumentDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects an accessLevel outside the enum', async () => {
      await expect(run({ ...valid, accessLevel: 'EVERYONE' }, CreateDocumentDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('CreateWaterConfigDto', () => {
    it('accepts a genuine config', async () => {
      await expect(
        run(
          { name: 'Block A', billingModel: WaterBillingModel.PER_KL, effectiveFrom: '2026-04-01', config: { rate: 25 } },
          CreateWaterConfigDto,
        ),
      ).resolves.toMatchObject({ name: 'Block A' });
    });

    it('rejects a billingModel outside the enum', async () => {
      await expect(
        run({ name: 'x', billingModel: 'PER_BUCKET', effectiveFrom: '2026-04-01', config: {} }, CreateWaterConfigDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('RecordReadingDto', () => {
    const valid = { flatId: 'flat-1', readingDate: '2026-09-01', openingReading: 100, closingReading: 150 };

    it('accepts a genuine reading', async () => {
      await expect(run(valid, RecordReadingDto)).resolves.toMatchObject({ flatId: 'flat-1' });
    });

    it('rejects a negative reading', async () => {
      await expect(run({ ...valid, openingReading: -5 }, RecordReadingDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('AllocateWaterCostsDto', () => {
    const valid = {
      billingPeriodId: 'period-1', readingDate: '2026-09-01',
      municipalWaterBill: 5000, tankerCost: 1000, commonElectricityBill: 3000, electricityWaterPercent: 20,
      readings: [{ flatId: 'flat-1', openingReading: 100, closingReading: 150 }],
    };

    it('accepts a genuine allocation', async () => {
      await expect(run(valid, AllocateWaterCostsDto)).resolves.toMatchObject({ tankerCost: 1000 });
    });

    it('rejects a negative cost field', async () => {
      await expect(run({ ...valid, tankerCost: -1000 }, AllocateWaterCostsDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects an electricityWaterPercent outside 0-100', async () => {
      await expect(run({ ...valid, electricityWaterPercent: 150 }, AllocateWaterCostsDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects an empty readings array', async () => {
      await expect(run({ ...valid, readings: [] }, AllocateWaterCostsDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects a reading with a non-numeric closingReading', async () => {
      await expect(
        run({ ...valid, readings: [{ flatId: 'flat-1', openingReading: 100, closingReading: 'a lot' }] }, AllocateWaterCostsDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('SendNotificationDto', () => {
    it('accepts a genuine notification', async () => {
      await expect(
        run({ title: 'Water outage', body: 'Water will be off 10am-2pm', type: 'ANNOUNCEMENT' }, SendNotificationDto),
      ).resolves.toMatchObject({ title: 'Water outage' });
    });

    it('accepts explicit channels and audience', async () => {
      await expect(
        run(
          { title: 'x', body: 'y', type: 'z', channels: [NotificationChannel.PUSH, NotificationChannel.EMAIL], audience: 'STAFF' },
          SendNotificationDto,
        ),
      ).resolves.toMatchObject({ channels: [NotificationChannel.PUSH, NotificationChannel.EMAIL] });
    });

    it('rejects a channel outside the enum', async () => {
      await expect(
        run({ title: 'x', body: 'y', type: 'z', channels: ['CARRIER_PIGEON'] }, SendNotificationDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an audience outside the enum', async () => {
      await expect(
        run({ title: 'x', body: 'y', type: 'z', audience: 'EVERYONE_EVER' }, SendNotificationDto),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
