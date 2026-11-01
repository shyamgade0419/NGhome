/**
 * Where the society's money is, in one picture that has to add up.
 *
 *   everything in the bank accounts
 *     = the corpus + every other fund + the rest (maintenance and general money)
 *
 * A fund is not a second pot: it is money earmarked inside the bank accounts. So the rest is simply what
 * the bank holds minus what the funds hold, and the three parts always sum to the bank by construction.
 * What can go wrong is the rest turning negative: the funds then claim more than the bank has, which means
 * a fund was topped up without the money arriving, or money left the bank without being taken from a fund.
 * That is reported, not hidden.
 *
 * Pure, with no database, so the arithmetic is tested on its own.
 */

import { Prisma } from '@prisma/client';

export interface SummaryAccount {
  id: string;
  name: string;
  currentBalance: Prisma.Decimal;
}
export interface SummaryFund {
  id: string;
  name: string;
  kind: 'CORPUS' | 'OTHER';
  currentBalance: Prisma.Decimal;
  isVisibleToResidents: boolean;
}

const money = (d: Prisma.Decimal) => d.toFixed(2);
const sum = (rows: { currentBalance: Prisma.Decimal }[]) =>
  rows.reduce((total, r) => total.plus(r.currentBalance), new Prisma.Decimal(0));

export function buildFundSummary(accounts: SummaryAccount[], funds: SummaryFund[]) {
  const bank = sum(accounts);
  const corpusFunds = funds.filter((f) => f.kind === 'CORPUS');
  const otherFunds = funds.filter((f) => f.kind !== 'CORPUS');
  const corpus = sum(corpusFunds);
  const other = sum(otherFunds);
  const inFunds = corpus.plus(other);
  const general = bank.minus(inFunds);

  const fundRow = (f: SummaryFund) => ({
    id: f.id,
    name: f.name,
    kind: f.kind,
    balance: money(f.currentBalance),
    isVisibleToResidents: f.isVisibleToResidents,
  });

  return {
    bankTotal: money(bank),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, balance: money(a.currentBalance) })),
    corpus: { total: money(corpus), funds: corpusFunds.map(fundRow) },
    other: { total: money(other), funds: otherFunds.map(fundRow) },
    fundsTotal: money(inFunds),
    // Maintenance and general money: what the bank holds that no fund has claimed.
    generalBalance: money(general),
    // True when the funds claim more than the bank holds, so the three parts cannot all be real.
    fundsExceedBank: general.isNegative(),
    // The check a reader can do by eye: corpus + other funds + general = the bank.
    adds: corpus.plus(other).plus(general).equals(bank),
  };
}
