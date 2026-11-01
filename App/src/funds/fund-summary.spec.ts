import { Prisma } from '@prisma/client';
import { buildFundSummary, type SummaryAccount, type SummaryFund } from './fund-summary';

const D = (v: string | number) => new Prisma.Decimal(v);
const account = (id: string, balance: string): SummaryAccount => ({ id, name: `Account ${id}`, currentBalance: D(balance) });
const fund = (id: string, kind: 'CORPUS' | 'OTHER', balance: string): SummaryFund => ({
  id, name: `Fund ${id}`, kind, currentBalance: D(balance), isVisibleToResidents: false,
});

describe('buildFundSummary', () => {
  it('splits the bank into the corpus, other funds and the rest, and they add up', () => {
    const s = buildFundSummary(
      [account('a', '400000.00'), account('b', '25000.50')],
      [fund('c', 'CORPUS', '250000'), fund('s', 'OTHER', '40000.25'), fund('f', 'OTHER', '10000')],
    );
    expect(s.bankTotal).toBe('425000.50');
    expect(s.corpus.total).toBe('250000.00');
    expect(s.other.total).toBe('50000.25');
    expect(s.fundsTotal).toBe('300000.25');
    expect(s.generalBalance).toBe('125000.25');
    expect(s.fundsExceedBank).toBe(false);
    expect(s.adds).toBe(true);
    expect(s.other.funds.map((f) => f.id)).toEqual(['s', 'f']);
  });

  it('keeps cents exact, with no floating-point drift', () => {
    const s = buildFundSummary([account('a', '0.30')], [fund('x', 'OTHER', '0.10'), fund('y', 'OTHER', '0.20')]);
    expect(s.fundsTotal).toBe('0.30');
    expect(s.generalBalance).toBe('0.00');
    expect(s.fundsExceedBank).toBe(false);
  });

  it('says so when the funds claim more than the bank holds', () => {
    const s = buildFundSummary([account('a', '1000')], [fund('c', 'CORPUS', '1500')]);
    expect(s.generalBalance).toBe('-500.00');
    expect(s.fundsExceedBank).toBe(true);
    // The three parts still sum to the bank; the negative rest is what exposes the mismatch.
    expect(s.adds).toBe(true);
  });

  it('copes with no funds and no accounts', () => {
    const s = buildFundSummary([], []);
    expect(s.bankTotal).toBe('0.00');
    expect(s.generalBalance).toBe('0.00');
    expect(s.corpus.funds).toEqual([]);
    expect(s.other.funds).toEqual([]);
    expect(s.fundsExceedBank).toBe(false);
  });

  it('files anything that is not the corpus under other funds', () => {
    const s = buildFundSummary([account('a', '100')], [fund('x', 'OTHER', '10')]);
    expect(s.corpus.funds).toHaveLength(0);
    expect(s.other.funds).toHaveLength(1);
  });
});
