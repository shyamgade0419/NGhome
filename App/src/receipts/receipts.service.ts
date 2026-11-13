import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { outstandingForFlat } from '../payments/settlement';
import { MONTH_NAMES } from '../billing/reminder-template';
import { receiptNumber, readReceiptToken, receiptSecret } from './receipt-link';
import type { ReceiptData } from './receipt-page';

/**
 * The receipt behind a receipt link. Anyone holding a valid link may read it, so it answers only for a payment the society
 * has approved, and for a link that is wrong, tampered with or for something else it says nothing about why.
 */
@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The receipt for a link's token, or null for anything that is not a valid link to an approved payment. */
  async forToken(token: unknown): Promise<ReceiptData | null> {
    const secret = receiptSecret();
    if (!secret) return null;
    const paymentId = readReceiptToken(token, secret);
    if (!paymentId) return null;

    const payment = await this.prisma.paymentSubmission.findFirst({
      where: { id: paymentId, status: 'APPROVED' },
      include: {
        user: { select: { firstName: true, lastName: true } },
        flat: { select: { flatCode: true } },
        allocations: {
          select: { amount: true, bill: { select: { invoiceNumber: true, billingPeriod: { select: { periodYear: true, periodMonth: true, kind: true } } } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!payment) return null;

    const society = await this.prisma.society.findUnique({
      where: { id: payment.societyId },
      select: { name: true, displayName: true, address: true, city: true, state: true },
    });
    const address = [society?.address, society?.city, society?.state].filter((p): p is string => !!p && p.trim().length > 0).join(', ');
    const balance = await outstandingForFlat(this.prisma, payment.societyId, payment.flatId);

    return {
      receiptNumber: receiptNumber(payment.id),
      society: { name: society?.displayName || society?.name || 'Society', address: address || null },
      paidOn: payment.paymentDate,
      amount: Number(payment.amount),
      method: payment.paymentMethod,
      reference: payment.utrNumber || payment.referenceNumber || payment.chequeNumber || null,
      payer: `${payment.user.firstName} ${payment.user.lastName}`.trim(),
      flat: payment.flat.flatCode,
      settled: payment.allocations.map((a) => {
        const p = a.bill.billingPeriod;
        return {
          invoice: a.bill.invoiceNumber,
          month: p.kind === 'OPENING' ? 'Opening balance' : `${MONTH_NAMES[p.periodMonth] ?? ''} ${p.periodYear}`.trim(),
          amount: Number(a.amount),
        };
      }),
      balance: Number(balance),
    };
  }
}
