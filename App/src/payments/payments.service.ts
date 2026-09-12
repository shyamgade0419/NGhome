import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from '../documents/sftp-storage.service';
import { assertAllowedUpload } from '../documents/file-safety';
import { StoragePathService } from '../documents/storage-path.service';
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
    private readonly paths: StoragePathService,
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

    /**
     * Idempotency: tap Submit, the request lands, the network dies before
     * the response does, tap Submit again with the same form still filled
     * in — the second request must not create a second payment. A UTR is a
     * real bank-assigned reference for one specific transaction, so the
     * same (flat, UTR) pair showing up twice is always a resubmission of
     * the same payment, never two legitimate ones — a genuinely different
     * payment (next month's bill, say) comes from a different bank
     * transaction and so always carries a different UTR. Cash/cheque
     * payments have no UTR and are unaffected (this only ever runs when
     * one was actually submitted); the unique index below is the same
     * check enforced at the database level for the case where two retries
     * race each other past this lookup.
     *
     * A found row isn't just handed back as-is — see resumeExistingSubmission
     * for the explicit rule per status: an early version of this just
     * returned whatever it found, which silently dropped a retry's proof
     * file and never gave a PENDING payment eligible for auto-approval a
     * second chance to actually get approved.
     */
    if (dto.utrNumber) {
      const existing = await this.prisma.paymentSubmission.findFirst({
        where: { societyId, flatId, utrNumber: dto.utrNumber },
      });
      if (existing) {
        return this.resumeAndReturn(societyId, flatId, userId, proofFile, existing);
      }
    }

    let bill: Awaited<ReturnType<typeof this.prisma.maintenanceBill.findFirst>> = null;
    if (dto.maintenanceBillId) {
      bill = await this.prisma.maintenanceBill.findFirst({
        where: { id: dto.maintenanceBillId, societyId, flatId },
      });
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.isPaid) throw new BadRequestException('Bill is already fully paid');
      // NG Home has no overpayment/advance-credit model — a bill's
      // paidAmount is not allowed to exceed its totalAmount. Without this,
      // a payment larger than what's owed would increment paidAmount past
      // totalAmount while pendingAmount gets clamped to 0, silently
      // recording money that was never actually credited anywhere.
      if (new Prisma.Decimal(dto.amount).greaterThan(bill.pendingAmount)) {
        throw new BadRequestException(
          `Payment amount exceeds the outstanding balance on this bill (₹${bill.pendingAmount.toString()}).`,
        );
      }
    }

    if (dto.billingPeriodId) {
      const period = await this.prisma.billingPeriod.findFirst({ where: { id: dto.billingPeriodId, societyId } });
      if (!period) throw new NotFoundException('Billing period not found in this society');
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

    // The proof upload is network I/O and cannot live inside a Postgres
    // transaction — but the remote path only needs societyId/flatId and a
    // random filename, never the payment's own id, so it can happen before
    // the payment row exists. Everything that follows (the row itself, the
    // Document that points at this file, and — for auto-approve — the
    // account credit, the Transaction, the bill update and the audit
    // record) runs in ONE transaction below, so there is no window where an
    // APPROVED payment exists without the money having actually moved.
    let proofRemotePath: string | undefined;
    if (proofFile) {
      proofRemotePath = this.paths.paymentProof(
        societyId,
        flatId,
        this.paths.storedFileName(proofFile.originalname),
      );
      await this.storage.upload(proofFile.buffer, proofRemotePath);
    }

    const amount = new Prisma.Decimal(dto.amount);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        let payment = await tx.paymentSubmission.create({
          data: {
            societyId,
            flatId,
            userId,
            maintenanceBillId: dto.maintenanceBillId,
            billingPeriodId: dto.billingPeriodId,
            amount,
            paymentDate: new Date(dto.paymentDate),
            paymentMethod: dto.paymentMethod,
            referenceNumber: dto.referenceNumber,
            utrNumber: dto.utrNumber,
            bankName: dto.bankName,
            chequeNumber: dto.chequeNumber,
            notes: dto.notes,
            // Always created PENDING, even when this will end up
            // auto-approved below — APPROVED is only ever written once the
            // account credit, Transaction, and bill update have all
            // succeeded too, atomically, further down this same callback.
            status: PaymentStatus.PENDING,
          },
        });

        // Attach the proof screenshot/receipt, if one was uploaded — a
        // Document row (reusing the same SFTP-backed storage flat documents
        // use), linked via the PaymentDocuments relation. accessLevel:
        // ADMIN_ONLY keeps it out of the resident's own generic Documents
        // list (this isn't a society document, it's evidence for one
        // specific payment); visibility for actually viewing it back is
        // enforced by getProofFile() below — the submitting resident +
        // admin/accountant, checked directly against this payment, not by
        // the generic Document accessLevel rules (which would otherwise
        // hide an ADMIN_ONLY doc from the very resident who uploaded it).
        if (proofFile && proofRemotePath) {
          await tx.document.create({
            data: {
              societyId,
              uploadedById: userId,
              title: `Payment proof — ${payment.id}`,
              fileName: proofFile.originalname,
              fileKey: proofRemotePath,
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

        // Auto-confirm: settle the bill without waiting for an admin.
        // Everything approve() does, minus the human — the account credit,
        // the Transaction, and linking transactionId back onto the payment,
        // all inside this same transaction, so the money always lands
        // somewhere before the payment can read as APPROVED. creditAndApprove
        // is shared with the resume path below (a retry against an existing
        // PENDING payment) — see it for why a claim runs here too even
        // though nothing else can see this just-created row yet.
        if (autoApprove && bill && soleAccountId) {
          const approved = await this.creditAndApprove(
            tx, societyId, payment, bill.id, soleAccountId, userId, 'auto',
          );
          if (approved) payment = approved;
        }

        return payment;
      });

      if (result.status === PaymentStatus.APPROVED) {
        await this.notifyAutoApproved(societyId, userId, result);
        return { ...result, autoApproved: true };
      }
      return result;
    } catch (err) {
      // Nothing in the transaction committed — including the payment row
      // itself — so a file with no Document row pointing at it can never be
      // reached again. remove() never throws, so the caller still sees the
      // real error.
      if (proofRemotePath) await this.storage.remove(proofRemotePath);

      // The idempotency lookup above is a best-effort fast path, not the
      // actual guarantee — two retries landing close enough together can
      // both pass it before either has written a row. The unique index on
      // (flatId, utrNumber) is what actually prevents the duplicate; P2002
      // here means it just caught exactly that race, on the paymentSubmission
      // .create() call above (the only write in this transaction touching
      // that index). Whichever request lost it returns the winner's row
      // instead of an error, so a resident who double-tapped Submit still
      // just sees their payment recorded.
      if (dto.utrNumber && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.paymentSubmission.findFirst({
          where: { societyId, flatId, utrNumber: dto.utrNumber },
        });
        // Same resume rule as the pre-check above — the loser of this race
        // still gets a chance to hand off whatever it uniquely had (a proof
        // file the winner's own attempt never supplied) to the row that
        // actually won, rather than that proof simply being deleted a few
        // lines above and never seen again.
        if (existing) return this.resumeAndReturn(societyId, flatId, userId, proofFile, existing);
      }
      throw err;
    }
  }

  /**
   * What a resubmission of an already-known (flatId, UTR) pair does,
   * broken out by the existing row's status — an explicit rule per state,
   * not "return whatever's there":
   *
   *  - APPROVED / REJECTED / CANCELLED: the outcome for this UTR is
   *    already decided. Return the existing record as-is. Never create a
   *    second PaymentSubmission or a second financial Transaction for a
   *    UTR that already has one (REJECTED/CANCELLED intentionally do NOT
   *    get a fresh attempt — a resident whose payment was rejected raises
   *    a new payment with a new UTR if they pay again; silently reopening
   *    a rejected UTR would let a resubmission bypass the reviewer who
   *    rejected it).
   *  - PENDING / UNDER_REVIEW: still open. Two things the *first* attempt
   *    may not have finished get a chance to complete now, without ever
   *    creating a second row or a second Transaction:
   *      (a) missing proof — if this retry supplies one and the existing
   *          row has none yet, attach it.
   *      (b) incomplete financial processing — if the row was never
   *          linked to a Transaction and it still qualifies for
   *          auto-approval, finish that now via the exact same atomic
   *          claim approve() itself uses, so a concurrent admin approve()
   *          or another concurrent resume can never both apply it.
   */
  private async resumeExistingSubmission(
    societyId: string,
    flatId: string,
    userId: string,
    proofFile: { originalname: string; size: number; mimetype: string; buffer: Buffer } | undefined,
    existing: NonNullable<Awaited<ReturnType<typeof this.prisma.paymentSubmission.findFirst>>>,
  ): Promise<{ payment: typeof existing; justAutoApproved: boolean }> {
    if (
      existing.status === PaymentStatus.APPROVED
      || existing.status === PaymentStatus.REJECTED
      || existing.status === PaymentStatus.CANCELLED
    ) {
      return { payment: existing, justAutoApproved: false };
    }

    let attachedProof = false;
    if (proofFile) {
      try {
        await this.attachProofIfMissing(societyId, flatId, userId, existing.id, proofFile);
        attachedProof = true;
      } catch {
        // Best-effort. A resident retrying "did my payment go through?"
        // must still get their existing payment back even if attaching the
        // proof this time around failed (SFTP unavailable, say) — that's
        // no worse than the original attempt's own proof having failed.
      }
    }

    if (!existing.transactionId) {
      const approved = await this.tryAutoApproveExisting(societyId, userId, existing);
      if (approved) return { payment: approved, justAutoApproved: true };
    }

    if (attachedProof) {
      // Something actually changed in the DB (a new Document is now
      // linked) — re-read so the caller's response reflects it, rather
      // than the stale snapshot taken before this call.
      return { payment: await this.findOne(societyId, existing.id), justAutoApproved: false };
    }

    return { payment: existing, justAutoApproved: false };
  }

  /** submit()'s two resume call sites share this: run the state machine
   *  above, send the same "payment approved" notification a fresh
   *  auto-approve gets if this resume is what finally completed it, and
   *  shape the return value the same way the create path does. */
  private async resumeAndReturn(
    societyId: string,
    flatId: string,
    userId: string,
    proofFile: { originalname: string; size: number; mimetype: string; buffer: Buffer } | undefined,
    existing: NonNullable<Awaited<ReturnType<typeof this.prisma.paymentSubmission.findFirst>>>,
  ) {
    const { payment, justAutoApproved } = await this.resumeExistingSubmission(
      societyId, flatId, userId, proofFile, existing,
    );
    if (justAutoApproved) {
      await this.notifyAutoApproved(societyId, userId, payment);
      return { ...payment, autoApproved: true };
    }
    return payment;
  }

  /**
   * Attempts to finish auto-approving an EXISTING PENDING/UNDER_REVIEW
   * payment that was never linked to a Transaction — re-evaluating
   * eligibility against current config/account state, not whatever was
   * true when it was first submitted. Returns null (never throws) if it
   * doesn't currently qualify, or if it loses a race to something else
   * that got there first (a concurrent admin approve(), or another
   * concurrent resume of the same UTR) — either way the payment is simply
   * left exactly as it was, safe to try again later.
   */
  private async tryAutoApproveExisting(
    societyId: string,
    actorId: string,
    payment: {
      id: string;
      amount: Prisma.Decimal;
      utrNumber: string | null;
      paymentDate: Date;
      maintenanceBillId: string | null;
    },
  ) {
    if (!payment.maintenanceBillId || !payment.utrNumber) return null;

    const config = await this.prisma.societyConfiguration.findUnique({
      where: { societyId },
      select: { paymentVerificationRequired: true },
    });
    if (config?.paymentVerificationRequired !== false) return null;

    const accounts = await this.prisma.account.findMany({
      where: { societyId, isActive: true },
      select: { id: true },
    });
    if (accounts.length !== 1) return null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const bill = await tx.maintenanceBill.findFirst({
          where: { id: payment.maintenanceBillId!, societyId },
        });
        if (!bill || bill.isPaid) return null;
        return this.creditAndApprove(tx, societyId, payment, bill.id, accounts[0].id, actorId, 'auto-resume');
      });
    } catch {
      // Including the overpayment guard inside creditAndApprove — a bill
      // that no longer has room for this amount is not this caller's
      // problem to surface as an error; the payment just stays PENDING for
      // manual review, exactly as if this resume attempt hadn't run.
      return null;
    }
  }

  /**
   * Shared financial mechanics for approving a payment: atomically claim
   * it, credit the account, write the ledger Transaction, atomically claim
   * and update the linked bill, and audit-log it. Used by both submit()'s
   * create-path auto-approve (where the claim is a no-op — the row was
   * just created in this same still-open transaction, so nothing else can
   * have touched it yet) and tryAutoApproveExisting's resume-path (where
   * the claim is the actual safety mechanism, since the row already
   * exists and a concurrent approve() or another concurrent resume could
   * be racing this one). Returns null if the claim is lost; throws (and so
   * rolls back everything this call already did, including the claim) if
   * the bill can no longer absorb the amount.
   */
  private async creditAndApprove(
    tx: Prisma.TransactionClient,
    societyId: string,
    payment: { id: string; amount: Prisma.Decimal; utrNumber: string | null; paymentDate: Date },
    billId: string,
    accountId: string,
    actorId: string,
    method: 'auto' | 'auto-resume',
  ) {
    const now = new Date();

    const claimed = await tx.paymentSubmission.updateMany({
      where: {
        id: payment.id,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.UNDER_REVIEW] },
        transactionId: null,
      },
      data: { status: PaymentStatus.APPROVED, reviewedAt: now, approvedAt: now },
    });
    if (claimed.count !== 1) return null;

    const updatedAccount = await tx.account.update({
      where: { id: accountId },
      data: { currentBalance: { increment: payment.amount } },
    });

    const transaction = await tx.transaction.create({
      data: {
        societyId,
        accountId,
        transactionType: 'CREDIT',
        amount: payment.amount,
        transactionDate: payment.paymentDate,
        description: `Payment received (auto-approved)${payment.utrNumber ? ` — UTR ${payment.utrNumber}` : ''}`,
        linkedEntityType: 'PaymentSubmission',
        linkedEntityId: payment.id,
        balanceAfter: updatedAccount.currentBalance,
        createdById: actorId,
      },
    });

    /**
     * Atomically claims the right to apply this amount, not just an
     * increment. A plain `paidAmount: { increment: amount }` is itself
     * atomic against losing an update, but says nothing about whether the
     * bill can still absorb this amount — two different payments for the
     * same bill, each individually within the outstanding balance at the
     * moment they were checked, can both pass a separate "read pending,
     * then increment" check and still jointly push paidAmount past
     * totalAmount, because neither check accounts for the other's
     * concurrent write. Folding the check into the WHERE clause of the
     * increment itself closes that: Postgres serializes two concurrent
     * UPDATEs against the same row, so the second one's WHERE
     * (pendingAmount >= amount) is evaluated against the first's already-
     * committed, already-reduced pendingAmount — at most one of two such
     * payments that would jointly overpay ever reports count === 1.
     */
    const billClaim = await tx.maintenanceBill.updateMany({
      where: { id: billId, pendingAmount: { gte: payment.amount } },
      data: { paidAmount: { increment: payment.amount } },
    });
    if (billClaim.count !== 1) {
      throw new BadRequestException('Payment amount exceeds the outstanding balance on this bill.');
    }
    const updatedBill = await tx.maintenanceBill.findUnique({ where: { id: billId } });
    if (!updatedBill) throw new NotFoundException('Bill not found');
    const pending = updatedBill.totalAmount.minus(updatedBill.paidAmount);
    await tx.maintenanceBill.update({
      where: { id: billId },
      data: {
        pendingAmount: pending.lessThan(0) ? new Prisma.Decimal(0) : pending,
        isPaid: pending.lessThanOrEqualTo(0),
      },
    });

    const updatedPayment = await tx.paymentSubmission.update({
      where: { id: payment.id },
      data: { transactionId: transaction.id },
    });

    // Same audit trail a manual approve() gets — this payment was approved
    // by the auto-approve rule, not left silently unlogged.
    await tx.auditLog.create({
      data: {
        societyId,
        actorId,
        action: 'PAYMENT_APPROVED',
        entityType: 'PaymentSubmission',
        entityId: payment.id,
        newValues: { status: 'APPROVED', transactionId: transaction.id, method } as Prisma.InputJsonValue,
      },
    });

    return updatedPayment;
  }

  /**
   * Attaches a proof file to an already-existing payment (a resume, not a
   * fresh submission). Best-effort race guard, same tolerance the rest of
   * this file accepts for pre-transaction network I/O: a genuinely
   * simultaneous double-resume could still both pass the "does one already
   * exist" check and both upload a proof for the same payment. That's a
   * harmless redundant file, never a financial duplicate — getProofFile()
   * already returns the most recent when more than one exists.
   */
  private async attachProofIfMissing(
    societyId: string,
    flatId: string,
    userId: string,
    paymentId: string,
    proofFile: { originalname: string; size: number; mimetype: string; buffer: Buffer },
  ) {
    const already = await this.prisma.document.findFirst({
      where: { linkedEntityType: 'PaymentSubmission', linkedEntityId: paymentId },
    });
    if (already) return already;

    const remotePath = this.paths.paymentProof(societyId, flatId, this.paths.storedFileName(proofFile.originalname));
    await this.storage.upload(proofFile.buffer, remotePath);
    try {
      return await this.prisma.document.create({
        data: {
          societyId,
          uploadedById: userId,
          title: `Payment proof — ${paymentId}`,
          fileName: proofFile.originalname,
          fileKey: remotePath,
          fileSize: proofFile.size,
          mimeType: proofFile.mimetype,
          storageProvider: 'sftp',
          accessLevel: DocumentAccessLevel.ADMIN_ONLY,
          linkedEntityType: 'PaymentSubmission',
          linkedEntityId: paymentId,
          payments: { connect: { id: paymentId } },
        },
      });
    } catch (err) {
      await this.storage.remove(remotePath);
      throw err;
    }
  }

  /** Outside any transaction, and best-effort — the same pattern approve()
   *  uses: a notification failing must never undo an approval that
   *  already committed. */
  private async notifyAutoApproved(
    societyId: string,
    userId: string,
    payment: { id: string; amount: Prisma.Decimal },
  ) {
    await this.notifications.notifyQuietly(
      () =>
        this.notifications.sendToUsers(societyId, [userId], {
          title: 'Payment approved',
          body: `Your payment of ₹${payment.amount.toString()} has been received and recorded.`,
          type: 'PAYMENT_APPROVED',
          data: { paymentId: payment.id },
        }),
      `payment ${payment.id} auto-approved`,
    );
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
        /**
         * Atomically claims the right to apply this amount, re-checked
         * against the bill's current state, not just what was true at
         * submission — another payment for the same bill may have been
         * approved first. Folding the check into the WHERE clause of the
         * increment itself (rather than a separate read-then-check) is
         * what makes this safe even when two *different* payments for the
         * same bill are approved at the exact same instant: Postgres
         * serializes two concurrent UPDATEs against the same row, so the
         * second's WHERE (pendingAmount >= amount) is evaluated against
         * the first's already-committed, already-reduced pendingAmount —
         * at most one of two approvals that would jointly overpay the bill
         * ever reports count === 1. Same pattern as submit()'s
         * auto-approve path above.
         */
        const claimed = await tx.maintenanceBill.updateMany({
          where: { id: payment.maintenanceBillId, pendingAmount: { gte: payment.amount } },
          data: { paidAmount: { increment: payment.amount } },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(
            "This payment exceeds the bill's current outstanding balance — another payment for the same " +
              'bill was likely approved first. Reject this payment or verify the amount before approving.',
          );
        }
        const updatedBill = await tx.maintenanceBill.findUnique({ where: { id: payment.maintenanceBillId } });
        if (!updatedBill) throw new NotFoundException('Bill not found');
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
    if (!this.paths.isSocietyKey(societyId, doc.fileKey)) {
      throw new NotFoundException('No proof file was attached to this payment');
    }

    const buffer = await this.storage.download(doc.fileKey);
    return { buffer, fileName: doc.fileName, mimeType: doc.mimeType };
  }
}
