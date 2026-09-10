import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from '../documents/sftp-storage.service';
import { assertAllowedUpload, safeStorageName } from '../documents/file-safety';
import { NotificationsService } from '../notifications/notifications.service';
import { SubmitPaymentDto } from './dto/submit-payment.dto';
import { DocumentAccessLevel, Prisma, PaymentStatus } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SftpStorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async submit(
    societyId: string,
    userId: string,
    flatId: string,
    dto: SubmitPaymentDto,
    proofFile?: { originalname: string; size: number; mimetype: string; buffer: Buffer },
  ) {
    // First, before anything is written. The proof is stored after the payment
    // row is created, so rejecting it there would leave a payment behind while
    // telling the resident the submission failed.
    if (proofFile) assertAllowedUpload(proofFile);

    const membership = await this.prisma.societyMembership.findFirst({
      where: { societyId, userId, flatId, status: 'ACTIVE' },
    });
    if (!membership) throw new ForbiddenException('Flat not assigned to your account');

    let bill: Awaited<ReturnType<typeof this.prisma.maintenanceBill.findFirst>> = null;
    if (dto.maintenanceBillId) {
      bill = await this.prisma.maintenanceBill.findFirst({
        where: { id: dto.maintenanceBillId, societyId, flatId },
      });
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.isPaid) throw new BadRequestException('Bill is already fully paid');
    }

    // Check if society requires manual payment verification
    const config = await this.prisma.societyConfiguration.findUnique({
      where: { societyId },
      select: { paymentVerificationRequired: true },
    });

    /**
     * Auto-approve has to land the money somewhere. It previously marked the
     * payment APPROVED and updated the bill without crediting any account or
     * writing a Transaction — only approve() does that — so with verification
     * switched off, bills read as paid while the money existed in no balance
     * and no ledger. The society's books drifted from the bank silently, and
     * nothing surfaced it.
     *
     * The account is only chosen when there is exactly one active account, so
     * the choice is never a guess. With several, putting real money in the
     * wrong ledger would go unnoticed for months, which is worse than asking
     * for a click — so the payment simply stays PENDING for manual approval,
     * where the admin picks the account as usual. Same when there are none.
     *
     * Failing back to PENDING is the point: the worst case becomes "an admin
     * approves it", which is what they would have done anyway.
     */
    const accounts = await this.prisma.account.findMany({
      where: { societyId, isActive: true },
      select: { id: true },
    });
    const soleAccountId = accounts.length === 1 ? accounts[0].id : null;

    const autoApprove =
      config?.paymentVerificationRequired === false &&
      !!dto.utrNumber &&
      !!bill &&
      !!soleAccountId;

    const payment = await this.prisma.paymentSubmission.create({
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
        status: autoApprove ? PaymentStatus.APPROVED : PaymentStatus.PENDING,
        ...(autoApprove ? { reviewedAt: new Date(), approvedAt: new Date() } : {}),
      },
    });

    // Attach the proof screenshot/receipt, if one was uploaded — a Document
    // row (reusing the same SFTP-backed storage flat documents use), linked
    // via the PaymentDocuments relation. accessLevel: ADMIN_ONLY keeps it
    // out of the resident's own generic Documents list (this isn't a
    // society document, it's evidence for one specific payment); visibility
    // for actually viewing it back is enforced by getProofFile() below —
    // the submitting resident + admin/accountant, checked directly against
    // this payment, not by the generic Document accessLevel rules (which
    // would otherwise hide an ADMIN_ONLY doc from the very resident who
    // uploaded it).
    if (proofFile) {
      const remotePath = `${this.storage.getBasePath()}/${societyId}/payment-proofs/${randomUUID()}-${safeStorageName(proofFile.originalname)}`;
      await this.storage.upload(proofFile.buffer, remotePath);
      await this.prisma.document.create({
        data: {
          societyId,
          uploadedById: userId,
          title: `Payment proof — ${payment.id}`,
          fileName: proofFile.originalname,
          fileKey: remotePath,
          fileSize: proofFile.size,
          mimeType: proofFile.mimetype,
          storageProvider: 'sftp',
          accessLevel: DocumentAccessLevel.ADMIN_ONLY,
          linkedEntityType: 'PaymentSubmission',
          linkedEntityId: payment.id,
          payments: { connect: { id: payment.id } },
        },
      });
    }

    // Auto-confirm: settle the bill without waiting for an admin. Everything
    // approve() does, minus the human — crucially including the account credit
    // and the Transaction, so the money actually lands somewhere.
    if (autoApprove && bill && soleAccountId) {
      const amount = new Prisma.Decimal(dto.amount);

      await this.prisma.$transaction(async (tx) => {
        const updatedAccount = await tx.account.update({
          where: { id: soleAccountId },
          data: { currentBalance: { increment: amount } },
        });

        await tx.transaction.create({
          data: {
            societyId,
            accountId: soleAccountId,
            transactionType: 'CREDIT',
            amount,
            transactionDate: new Date(dto.paymentDate),
            description: `Payment received (auto-approved)${dto.utrNumber ? ` — UTR ${dto.utrNumber}` : ''}`,
            linkedEntityType: 'PaymentSubmission',
            linkedEntityId: payment.id,
            balanceAfter: updatedAccount.currentBalance,
            createdById: userId,
          },
        });

        // Atomic increment rather than the read-modify-write this used to do:
        // two payments landing together would otherwise each write a total
        // computed from the same stale starting figure, losing one of them.
        const updatedBill = await tx.maintenanceBill.update({
          where: { id: bill.id },
          data: { paidAmount: { increment: amount } },
        });

        const pending = updatedBill.totalAmount.minus(updatedBill.paidAmount);
        await tx.maintenanceBill.update({
          where: { id: bill.id },
          data: {
            pendingAmount: pending.lessThan(0) ? new Prisma.Decimal(0) : pending,
            isPaid: pending.lessThanOrEqualTo(0),
          },
        });
      });

      return { ...payment, autoApproved: true };
    }

    return payment;
  }

  async approve(societyId: string, paymentId: string, reviewedById: string, accountId: string, notes?: string) {
    // Fetch payment data outside the transaction (for amount, flatId, etc.)
    const payment = await this.findOne(societyId, paymentId);

    const approved = await this.prisma.$transaction(async (tx) => {
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
        // Decimal, not float. `newPending === 0` on a float subtraction can
        // land on 1e-13 for a bill with paise, leaving a fully paid bill
        // marked unpaid with no way for the resident to clear it.
        const pending = updatedBill.totalAmount.minus(updatedBill.paidAmount);
        await tx.maintenanceBill.update({
          where: { id: payment.maintenanceBillId },
          data: {
            pendingAmount: pending.lessThan(0) ? new Prisma.Decimal(0) : pending,
            isPaid: pending.lessThanOrEqualTo(0),
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

    // Outside the transaction, and best-effort: "did my payment go through?"
    // is the question this answers, but failing to answer it must never undo
    // an approval that already succeeded.
    await this.notifications.notifyQuietly(
      () =>
        this.notifications.sendToUsers(societyId, [payment.userId], {
          title: 'Payment approved',
          body: `Your payment of ₹${payment.amount.toString()} has been received and recorded.`,
          type: 'PAYMENT_APPROVED',
          data: { paymentId },
        }),
      `payment ${paymentId} approved`,
    );

    return approved;
  }

  async reject(societyId: string, paymentId: string, reviewedById: string, reason: string) {
    // Fetch for society scope check; status gate is inside the transaction
    const payment = await this.findOne(societyId, paymentId);

    const rejected = await this.prisma.$transaction(async (tx) => {
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

    // The reason is the point: a rejection the resident cannot see leaves
    // them thinking the bill is settled when it isn't.
    await this.notifications.notifyQuietly(
      () =>
        this.notifications.sendToUsers(societyId, [payment.userId], {
          title: 'Payment not accepted',
          body: `Your payment of ₹${payment.amount.toString()} was not accepted. Reason: ${reason}`,
          type: 'PAYMENT_REJECTED',
          data: { paymentId },
        }),
      `payment ${paymentId} rejected`,
    );

    return rejected;
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
          documents: { select: { id: true, fileName: true, mimeType: true } },
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
        documents: { select: { id: true, fileName: true, mimeType: true } },
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
          documents: { select: { id: true, fileName: true, mimeType: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentSubmission.count({ where: { societyId, userId } }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  /**
   * Not gated by the generic Document accessLevel rules (see submit()) —
   * this payment's own owner, plus admin/accountant, regardless of the
   * resident's own flat. Only one proof file is supported per payment
   * today (the UI only ever attaches one); this returns the most recent
   * if that ever changes.
   */
  async getProofFile(societyId: string, paymentId: string, caller: { id: string; isReviewer: boolean }) {
    const payment = await this.prisma.paymentSubmission.findFirst({
      where: { id: paymentId, societyId },
      include: {
        documents: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!caller.isReviewer && payment.userId !== caller.id) {
      throw new ForbiddenException('You can only view proof for your own payment submissions.');
    }

    const doc = payment.documents[0];
    if (!doc) throw new NotFoundException('No proof file was attached to this payment');

    const buffer = await this.storage.download(doc.fileKey);
    return { buffer, fileName: doc.fileName, mimeType: doc.mimeType };
  }
}
