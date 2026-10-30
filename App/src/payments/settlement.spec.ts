import { Prisma } from '@prisma/client';
import { MAX_ADVANCE_MONTHS, maxPayment, planAllocation } from './settlement';

const D = (n: number | string) => new Prisma.Decimal(n);
const bill = (id: string, pending: number) => ({ id, billingPeriodId: `p-${id}`, pendingAmount: D(pending) });
const shape = (plan: ReturnType<typeof planAllocation>) => plan.allocations.map((a) => [a.billId, a.amount.toString()]);

describe('planAllocation — oldest dues first', () => {
  const bills = [bill('aug', 1000), bill('sep', 1000), bill('oct', 1000)];

  it('clears the oldest month before touching a newer one', () => {
    const plan = planAllocation(bills, D(1500));
    expect(shape(plan)).toEqual([['aug', '1000'], ['sep', '500']]);
    expect(plan.excess.toString()).toBe('0');
  });

  it('settles every month when paid in full', () => {
    const plan = planAllocation(bills, D(3000));
    expect(shape(plan)).toEqual([['aug', '1000'], ['sep', '1000'], ['oct', '1000']]);
    expect(plan.excess.toString()).toBe('0');
  });

  it('takes a payment smaller than the oldest month entirely from it', () => {
    expect(shape(planAllocation(bills, D(250)))).toEqual([['aug', '250']]);
  });

  it('allocates exactly what was paid, dues and advance together', () => {
    const plan = planAllocation(bills, D('1234.56'));
    expect(plan.allocations.reduce((s, a) => s.plus(a.amount), D(0)).plus(plan.excess).toString()).toBe('1234.56');
  });

  it('skips a month with nothing pending', () => {
    expect(shape(planAllocation([bill('aug', 0), bill('sep', 400)], D(300)))).toEqual([['sep', '300']]);
  });

  it('keeps paise exact — no float drift', () => {
    expect(shape(planAllocation([bill('a', 0.1), bill('b', 0.2)], D('0.3')))).toEqual([['a', '0.1'], ['b', '0.2']]);
  });
});

describe('planAllocation — paying ahead', () => {
  const bills = [bill('aug', 1000), bill('sep', 1000)];

  it('clears every due, then keeps the rest as advance', () => {
    const plan = planAllocation(bills, D(3500));
    expect(shape(plan)).toEqual([['aug', '1000'], ['sep', '1000']]);
    expect(plan.excess.toString()).toBe('1500');
  });

  it('is all advance when nothing is owed', () => {
    const plan = planAllocation([], D(2500));
    expect(plan.allocations).toEqual([]);
    expect(plan.excess.toString()).toBe('2500');
  });

  it('is all advance when every bill is already paid', () => {
    const plan = planAllocation([bill('a', 0), bill('b', 0)], D(700));
    expect(plan.allocations).toEqual([]);
    expect(plan.excess.toString()).toBe('700');
  });

  it('leaves no advance when the payment is exactly what is owed', () => {
    expect(planAllocation(bills, D(2000)).excess.toString()).toBe('0');
  });

  it('keeps paise exact in the advance', () => {
    expect(planAllocation([bill('a', 100)], D('250.35')).excess.toString()).toBe('150.35');
  });
});

describe('the most a payment can be', () => {
  it('is what is owed plus a year of the flat\'s bill', () => {
    expect(MAX_ADVANCE_MONTHS).toBe(12);
    expect(maxPayment(D(3000), D(2500)).toString()).toBe('33000');
  });

  it('is a year of the bill when nothing is owed', () => {
    expect(maxPayment(D(0), D(2500)).toString()).toBe('30000');
  });
});
