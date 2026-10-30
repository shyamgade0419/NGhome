import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { planAllocation } from './settlement';

const D = (n: number | string) => new Prisma.Decimal(n);
const bill = (id: string, pending: number) => ({ id, billingPeriodId: `p-${id}`, pendingAmount: D(pending) });
const shape = (plan: ReturnType<typeof planAllocation>) => plan.map((a) => [a.billId, a.amount.toString()]);

describe('planAllocation — oldest dues first', () => {
  const bills = [bill('aug', 1000), bill('sep', 1000), bill('oct', 1000)];

  it('clears the oldest month before touching a newer one', () => {
    expect(shape(planAllocation(bills, D(1500)))).toEqual([['aug', '1000'], ['sep', '500']]);
  });

  it('settles every month when paid in full', () => {
    expect(shape(planAllocation(bills, D(3000)))).toEqual([['aug', '1000'], ['sep', '1000'], ['oct', '1000']]);
  });

  it('takes a payment smaller than the oldest month entirely from it', () => {
    expect(shape(planAllocation(bills, D(250)))).toEqual([['aug', '250']]);
  });

  it('allocates exactly what was paid', () => {
    const plan = planAllocation(bills, D('1234.56'));
    expect(plan.reduce((s, a) => s.plus(a.amount), D(0)).toString()).toBe('1234.56');
  });

  it('skips a month with nothing pending', () => {
    expect(shape(planAllocation([bill('aug', 0), bill('sep', 400)], D(300)))).toEqual([['sep', '300']]);
  });

  it('refuses a payment bigger than everything owed, saying how much is owed', () => {
    expect(() => planAllocation(bills, D(3000.01))).toThrow(BadRequestException);
    expect(() => planAllocation(bills, D(3500))).toThrow(/owes \(₹3000\)/);
  });

  it('refuses any payment when nothing is owed', () => {
    expect(() => planAllocation([], D(1))).toThrow(BadRequestException);
  });

  it('keeps paise exact — no float drift', () => {
    const plan = planAllocation([bill('a', 0.1), bill('b', 0.2)], D('0.3'));
    expect(shape(plan)).toEqual([['a', '0.1'], ['b', '0.2']]);
  });
});
