import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitPaymentDto } from './dto/submit-payment.dto';
import { Prisma, PaymentStatus } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(
    societyId: string,
    userId: string,
    flatId: string,
    dto: SubmitPaymentDto,
  ) {
    const membership = await this.prisma.societyMembership.findFirst({
      where: { societyId, userId, flatId, status: 'ACTIVE' },
    });
    if (!membership) throw new ForbiddenException('Flat not assigned to your account');

    if (dto.maintenanceBillId) {
      const bill = await this.prisma.maintenanceBill.findFirst({
        where: { id: dto.maintenanceBillId, societyId, flatId },
      });
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.isPaid) throw new BadRequestException('Bill is already fully paid');
    }

    return this.prisma.paymentSubmission.create({
      data: {
        societyId,
        flatId,
        userId,
        maintenanceBillId: dto.maintenanceBillId,
        billingPeriodId: dto.billingPeriodId,
        amount: new Prisma.Decimal(dto.amount),
        paymentDate: new Date(dto.paymentDate),
        paymentMethod: dto.paymentMethod,
        referenceNumber: dto.referenceNumber,
        utrNumber: dto.utrNumber,
        bankName: dto.bankName,
        chequeNumber: dto.chequeNumber,
        notes: dto.notes,
        status: PaymentStatus.PENDING,
      },
    });
  }

  async approve(societyId: string, paymentId: string, reviewedById: string, accountId: string, notes?: string) {
    // Fetch payment data outside the transaction (for amount, flatId, etc.)
    const payment = await this.findOne(societyId, paymentId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // 1. Atomic status check-and-update. If another request already approved this
      //    payment, updateMany returns count=0 and we bail out before touching finances.
      const { count } = await tx.paymentSubmission.updateMany({
        where: {
          id: paymentId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.UNDER_REVIEW] },
        },
        data: {
          status: PaymentStatus.APPROVED,
          reviewedAt: now,
          reviewedById,
          approvedAt: now,
          reviewNotes: notes,
        },
      });
      if (count === 0) {
        throw new BadRequestException('Payment is not in a reviewable state');
      }

      // 2. Verify account belongs to society
      const account = await tx.account.findFirst({ where: { id: accountId, societyId } });
      if (!account) throw new NotFoundException('Account not found');

      // 3. Atomic balance increment — avoids read-modify-write race across concurrent approvals
      const updatedAccount = await tx.account.update({
        where: { id: accountId },
        data: { currentBalance: { increment: payment.amount } },
      });

      // 4. Create financial transaction
      const transaction = await tx.transaction.create({
        data: {
          societyId,
          accountId,
          transactionType: 'CREDIT',
          amount: payment.amount,
          transactionDate: new Date(payment.paymentDate),
          reference: payment.referenceNumber ?? payment.utrNumber ?? undefined,
          description: `Payment from flat ${payment.flatId}`,
          linkedEntityType: 'PAYMENT',
          linkedEntityId: paymentId,
          balanceAfter: updatedAccount.currentBalance,
          createdById: reviewedById,
        },
      });

      // 5. Update bill paid/pending amounts if linked
      if (payment.maintenanceBillId) {
        // Increment paidAmount atomically; pendingAmount is derived from the post-increment value
        const updatedBill = await tx.maintenanceBill.update({
          where: { id: payment.maintenanceBillId },
          data: { paidAmount: { increment: payment.amount } },
        });
        const newPending = Math.max(
          0,
          updatedBill.totalAmount.toNumber() - updatedBill.paidAmount.toNumber(),
        );
        await tx.maintenanceBill.update({
          where: { id: payment.maintenanceBillId },
          data: {
            pendingAmount: new Prisma.Decimal(newPending),
            isPaid: newPending === 0,
          },
        });
      }

      // 6. Link transaction to payment
      await tx.paymentSubmission.update({
        where: { id: paymentId },
        data: { transactionId: transaction.id },
      });

      // 7. Audit log
      await tx.auditLog.create({
        data: {
          societyId,
          actorId: reviewedById,
          action: 'PAYMENT_APPROVED',
          entityType: 'PaymentSubmission',
          entityId: paymentId,
          newValues: { status: 'APPROVED', transactionId: transaction.id } as Prisma.InputJsonValue,
        },
      });

      return tx.paymentSubmission.findUnique({ where: { id: paymentId } });
    });
  }

  async reject(societyId: string, paymentId: string, reviewedById: string, reason: string) {
    // Fetch for society scope check; status gate is inside the transaction
    await this.findOne(societyId, paymentId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const { count } = await tx.paymentSubmission.updateMany({
        where: {
          id: paymentId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.UNDER_REVIEW] },
        },
        data: {
          status: PaymentStatus.REJECTED,
          reviewedAt: now,
          reviewedById,
          rejectedAt: now,
          reviewNotes: reason,
        },
      });
      if (count === 0) {
        throw new BadRequestException('Payment is not in a reviewable state');
      }

      await tx.auditLog.create({
        data: {
          societyId,
          actorId: reviewedById,
          action: 'PAYMENT_REJECTED',
          entityType: 'PaymentSubmission',
          entityId: paymentId,
          newValues: { status: 'REJECTED', reason } as Prisma.InputJsonValue,
        },
      });

      return tx.paymentSubmission.findUnique({ where: { id: paymentId } });
    });
  }

  async findAll(societyId: string, page: number, limit: number, status?: PaymentStatus) {
    const { skip, take } = getPaginationParams({ page, limit });
    const where: Prisma.PaymentSubmissionWhereInput = {
      societyId,
      ...(status ? { status } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.paymentSubmission.findMany({
        skip,
        take,
        where,
        include: {
          flat: { select: { id: true, flatCode: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
          maintenanceBill: { select: { id: true, invoiceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentSubmission.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(societyId: string, paymentId: string) {
    const payment = await this.prisma.paymentSubmission.findFirst({
      where: { id: paymentId, societyId },
      include: {
        flat: { select: { id: true, flatCode: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async findMyPayments(societyId: string, userId: string, page: number, limit: number) {
    const { skip, take } = getPaginationParams({ page, limit });
    const [data, total] = await Promise.all([
      this.prisma.paymentSubmission.findMany({
        skip,
        take,
        where: { societyId, userId },
        include: {
          maintenanceBill: { select: { id: true, invoiceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentSubmission.count({ where: { societyId, userId } }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }
}
