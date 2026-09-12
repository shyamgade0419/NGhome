/**
 * Payment proof upload/retrieval — residents had nowhere to attach a
 * receipt/screenshot for admin to verify, and even after wiring an upload
 * path in, retrieval needed a rule the generic Document accessLevel system
 * can't express: the specific payment's own submitter, plus any reviewer,
 * regardless of whose flat the reviewer happens to live on.
 */

import { PaymentsService } from './payments.service';
import { SubmitPaymentDto } from './dto/submit-payment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from '../documents/sftp-storage.service';
import { StoragePathService } from '../documents/storage-path.service';
import { NotificationsService } from '../notifications/notifications.service';

// Real JPEG magic bytes (FF D8 FF) — assertAllowedUpload now checks a
// proof's actual signature, not just its claimed extension/MIME type, so a
// placeholder buffer like Buffer.from('x') is no longer a valid fixture.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/** Notifications are best-effort side effects — these tests assert on the
 *  money paths, so a no-op stands in. notifyQuietly runs the callback so a
 *  mistake inside a notification block still surfaces here. */
const notificationsStub = () =>
  ({
    sendToUsers: jest.fn().mockResolvedValue(null),
    send: jest.fn().mockResolvedValue(null),
    notifyQuietly: jest.fn(async (fn: () => Promise<unknown>) => { await fn(); }),
  }) as unknown as NotificationsService;
import { ForbiddenException, NotFoundException } from '@nestjs/common';

const SOCIETY_ID = 'society-a';
const PAYMENT_ID = 'payment-1';
const OWNER_ID = 'resident-1';
const OTHER_RESIDENT_ID = 'resident-2';

function makeServices(documents: Array<{ id: string; fileKey: string; fileName: string; mimeType: string; createdAt?: Date }>) {
  const prisma = {
    paymentSubmission: {
      findFirst: jest.fn().mockResolvedValue({
        id: PAYMENT_ID,
        societyId: SOCIETY_ID,
        userId: OWNER_ID,
        documents,
      }),
    },
    document: { create: jest.fn() },
  } as unknown as PrismaService;

  const storage = {
    download: jest.fn().mockResolvedValue(Buffer.from('file-bytes')),
    upload: jest.fn().mockResolvedValue(undefined),
    getBasePath: jest.fn().mockReturnValue('/ng-home-documents'),
  } as unknown as SftpStorageService;

  return { prisma, storage, service: new PaymentsService(prisma, storage, notificationsStub(), new StoragePathService(storage)) };
}

describe('PaymentsService.getProofFile', () => {
  // Stored under the layout used before the per-flat reorganisation; such
  // files are left where they are and must still download.
  const LEGACY_KEY = `/ng-home-documents/${SOCIETY_ID}/payment-proofs/3f2b8c1e-receipt.jpg`;
  const doc = { id: 'doc-1', fileKey: LEGACY_KEY, fileName: 'receipt.jpg', mimeType: 'image/jpeg' };

  it('lets the payment owner download their own proof', async () => {
    const { service, storage } = makeServices([doc]);
    const result = await service.getProofFile(SOCIETY_ID, PAYMENT_ID, { id: OWNER_ID, isReviewer: false });
    expect(result.fileName).toBe('receipt.jpg');
    expect((storage.download as jest.Mock)).toHaveBeenCalledWith(LEGACY_KEY);
  });

  it.each([
    '/ng-home-documents/society-b/residents/flat-1/payments/x.jpg',
    `/ng-home-documents/${SOCIETY_ID}/../society-b/payment-proofs/x.jpg`,
    '/etc/passwd',
  ])('never reads a stored key outside the society folder: %s', async (fileKey) => {
    const { service, storage } = makeServices([{ ...doc, fileKey }]);
    await expect(
      service.getProofFile(SOCIETY_ID, PAYMENT_ID, { id: OWNER_ID, isReviewer: false }),
    ).rejects.toThrow(NotFoundException);
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('lets a reviewer (admin/accountant) download regardless of their own flat', async () => {
    const { service } = makeServices([doc]);
    await expect(
      service.getProofFile(SOCIETY_ID, PAYMENT_ID, { id: 'admin-1', isReviewer: true }),
    ).resolves.toEqual(expect.objectContaining({ fileName: 'receipt.jpg' }));
  });

  it('blocks a different resident who is not the owner and not a reviewer', async () => {
    const { service } = makeServices([doc]);
    await expect(
      service.getProofFile(SOCIETY_ID, PAYMENT_ID, { id: OTHER_RESIDENT_ID, isReviewer: false }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when no proof was ever attached', async () => {
    const { service } = makeServices([]);
    await expect(
      service.getProofFile(SOCIETY_ID, PAYMENT_ID, { id: OWNER_ID, isReviewer: false }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('PaymentsService.submit — proof attachment', () => {
  function makeSubmitPrisma(payment: { id: string }) {
    const tx = {
      paymentSubmission: { create: jest.fn().mockResolvedValue(payment) },
      document: { create: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    };
    return {
      societyMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
      maintenanceBill: { findFirst: jest.fn() },
      societyConfiguration: { findUnique: jest.fn().mockResolvedValue({ paymentVerificationRequired: true }) },
      // submit() checks the society's accounts to decide whether auto-approve
      // can land the money anywhere. These cases require verification, so the
      // list is never used — it just has to exist.
      account: { findMany: jest.fn().mockResolvedValue([]) },
      paymentSubmission: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    } as unknown as PrismaService & { __tx: typeof tx };
  }

  it('uploads and links a Document when a proof file is provided', async () => {
    const prisma = makeSubmitPrisma({ id: PAYMENT_ID });
    const storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      getBasePath: jest.fn().mockReturnValue('/ng-home-documents'),
    } as unknown as SftpStorageService;
    const service = new PaymentsService(prisma, storage, notificationsStub(), new StoragePathService(storage));

    await service.submit(
      SOCIETY_ID, OWNER_ID, 'flat-1',
      { amount: 500, paymentDate: '2026-01-01', paymentMethod: 'UPI' } as any,
      { originalname: 'receipt.jpg', size: 1234, mimetype: 'image/jpeg', buffer: JPEG_BYTES },
    );

    expect((storage.upload as jest.Mock)).toHaveBeenCalled();
    expect((prisma as any).__tx.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accessLevel: 'ADMIN_ONLY',
          payments: { connect: { id: PAYMENT_ID } },
        }),
      }),
    );
  });

  it('does not touch storage when no proof file is provided', async () => {
    const prisma = makeSubmitPrisma({ id: PAYMENT_ID });
    const storage = {
      upload: jest.fn(),
      getBasePath: jest.fn().mockReturnValue('/ng-home-documents'),
    } as unknown as SftpStorageService;
    const service = new PaymentsService(prisma, storage, notificationsStub(), new StoragePathService(storage));

    await service.submit(
      SOCIETY_ID, OWNER_ID, 'flat-1',
      { amount: 500, paymentDate: '2026-01-01', paymentMethod: 'CASH' } as any,
    );

    expect((storage.upload as jest.Mock)).not.toHaveBeenCalled();
    expect((prisma as any).__tx.document.create).not.toHaveBeenCalled();
  });
});

/**
 * Auto-approve had to land the money somewhere.
 *
 * With paymentVerificationRequired off, submit() marked the payment APPROVED
 * and updated the bill but credited no account and wrote no Transaction —
 * only approve() did that. Bills read as paid while the money existed in no
 * balance and no ledger, and nothing surfaced the drift.
 */

import { Prisma, PaymentStatus } from '@prisma/client';

const FLAT_ID = 'flat-1';
const BILL_ID = 'bill-1';

function makeSubmitServices(opts: { accounts: { id: string }[]; verificationRequired?: boolean }) {
  const bill = {
    id: BILL_ID,
    societyId: SOCIETY_ID,
    flatId: FLAT_ID,
    isPaid: false,
    totalAmount: new Prisma.Decimal(2500),
    paidAmount: new Prisma.Decimal(0),
    pendingAmount: new Prisma.Decimal(2500),
  };

  // Everything submit() writes now runs inside one $transaction(tx => ...)
  // callback — tx stands in for the whole write surface, including the
  // payment row itself, so an auto-approved payment's status/transactionId
  // update and its audit record are exercised by the very same mock the
  // account/bill assertions already use.
  const tx = {
    paymentSubmission: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: PAYMENT_ID, ...data })),
      // creditAndApprove's atomic claim — a no-op guard for the create
      // path (nothing else can see this just-created row yet), so it
      // always succeeds here.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      // A real Prisma update() returns the full row, not just the changed
      // fields — the mock merges over a realistic base row so fields the
      // service reads afterwards (amount, for the notification body) are
      // there, the same as they'd be in production. status: APPROVED here
      // reflects reality: by the time creditAndApprove's own update() call
      // runs (linking transactionId), the earlier atomic claim (updateMany)
      // already committed that status change within this same transaction.
      update: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: PAYMENT_ID, status: PaymentStatus.APPROVED, amount: new Prisma.Decimal(2500), flatId: FLAT_ID, ...data,
        }),
      ),
    },
    document: { create: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    account: {
      update: jest.fn().mockResolvedValue({ id: 'account-1', currentBalance: new Prisma.Decimal(2500) }),
    },
    transaction: { create: jest.fn().mockResolvedValue({ id: 'txn-1' }) },
    maintenanceBill: {
      // tryAutoApproveExisting's own bill lookup, inside its transaction —
      // separate from the top-level prisma.maintenanceBill.findFirst used
      // by the create path's pre-transaction validation.
      findFirst: jest.fn().mockResolvedValue(bill),
      // The atomic conditional claim (WHERE pendingAmount >= amount) — see
      // PaymentsService.submit. submitDto's amount (2500) never exceeds
      // this mock bill's pendingAmount (2500), so this always claims.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(bill),
      update: jest
        .fn()
        .mockResolvedValue({ ...bill, paidAmount: new Prisma.Decimal(2500), totalAmount: new Prisma.Decimal(2500) }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };

  const prisma = {
    societyMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
    maintenanceBill: { findFirst: jest.fn().mockResolvedValue(bill) },
    billingPeriod: { findFirst: jest.fn().mockResolvedValue({ id: 'period-1', societyId: SOCIETY_ID }) },
    societyConfiguration: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ paymentVerificationRequired: opts.verificationRequired ?? false }),
    },
    account: { findMany: jest.fn().mockResolvedValue(opts.accounts) },
    paymentSubmission: {
      // No existing payment for this (flat, UTR) unless a test says otherwise.
      findFirst: jest.fn().mockResolvedValue(null),
      // The transaction failure/P2002 fallback path calls this directly on
      // the top-level client (outside the rolled-back transaction).
      create: jest.fn(),
    },
    // attachProofIfMissing's "does this payment already have a proof"
    // check, when a resume path runs — no document unless a test says
    // otherwise.
    document: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'doc-resume-1' }) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as unknown as PrismaService;

  const storage = {
    upload: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    getBasePath: jest.fn().mockReturnValue('/ng-home-documents'),
  } as unknown as SftpStorageService;
  const notifications = notificationsStub();
  return {
    service: new PaymentsService(prisma, storage, notifications, new StoragePathService(storage)),
    prisma,
    tx,
    storage,
    notifications,
  };
}

const submitDto = {
  maintenanceBillId: BILL_ID,
  amount: 2500,
  paymentDate: '2026-09-09',
  paymentMethod: 'UPI' as any,
  utrNumber: '426117890123',
};

describe('PaymentsService.submit — cross-society billingPeriodId is rejected', () => {
  it('refuses a billingPeriodId from another society, and creates nothing', async () => {
    const { service, prisma, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    (prisma.billingPeriod.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, { ...submitDto, billingPeriodId: 'period-from-society-b' }),
    ).rejects.toThrow(NotFoundException);
    expect(tx.paymentSubmission.create).not.toHaveBeenCalled();
  });
});

describe('PaymentsService — auto-approve lands the money', () => {
  it('credits the account and writes a CREDIT transaction when exactly one account exists', async () => {
    const { service, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    const result: any = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    expect(result.autoApproved).toBe(true);
    expect(tx.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'account-1' },
        data: { currentBalance: { increment: expect.anything() } },
      }),
    );
    const [txArg] = tx.transaction.create.mock.calls[0];
    expect(txArg.data).toMatchObject({
      accountId: 'account-1',
      transactionType: 'CREDIT',
      linkedEntityType: 'PaymentSubmission',
    });
  });

  it('stays PENDING rather than stranding the money when several accounts exist', async () => {
    // Guessing which account would put real money in the wrong ledger and go
    // unnoticed; an admin picking one is the lesser cost.
    const { service, tx } = makeSubmitServices({
      accounts: [{ id: 'account-1' }, { id: 'account-2' }],
    });
    const result: any = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    expect(result.autoApproved).toBeUndefined();
    expect(result.status).toBe('PENDING');
    expect(tx.account.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it('stays PENDING when the society has no account at all', async () => {
    const { service, tx } = makeSubmitServices({ accounts: [] });
    const result: any = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    expect(result.status).toBe('PENDING');
    expect(tx.account.update).not.toHaveBeenCalled();
  });

  it('stays PENDING when the society requires verification, even with one account', async () => {
    const { service, tx } = makeSubmitServices({
      accounts: [{ id: 'account-1' }],
      verificationRequired: true,
    });
    const result: any = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    expect(result.status).toBe('PENDING');
    expect(tx.account.update).not.toHaveBeenCalled();
  });

  it('stays PENDING without a UTR', async () => {
    const { service, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    const result: any = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, {
      ...submitDto,
      utrNumber: undefined,
    });

    expect(result.status).toBe('PENDING');
    expect(tx.account.update).not.toHaveBeenCalled();
  });

  it('claims the bill increment atomically (conditional on the outstanding balance), rather than an unconditional write', async () => {
    const { service, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    const [billArg] = tx.maintenanceBill.updateMany.mock.calls[0];
    expect(billArg.where.pendingAmount).toEqual({ gte: expect.anything() });
    expect(billArg.data).toEqual({ paidAmount: { increment: expect.anything() } });
  });

  it(
    'is created PENDING, then atomically claimed (status → APPROVED) before the account/transaction/bill writes ' +
      '— never durably visible as APPROVED without them, since a later failure rolls back the whole transaction',
    async () => {
      const { service, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
      await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

      const [createArg] = tx.paymentSubmission.create.mock.calls[0];
      expect(createArg.data.status).toBe('PENDING');

      // creditAndApprove's atomic claim — the same conditional transition
      // approve() uses, run here too even though nothing else can see this
      // just-created row yet within the same still-open transaction; see
      // creditAndApprove's own doc comment for why.
      const [claimArg] = tx.paymentSubmission.updateMany.mock.calls[0];
      expect(claimArg.where).toMatchObject({ status: { in: [PaymentStatus.PENDING, PaymentStatus.UNDER_REVIEW] }, transactionId: null });
      expect(claimArg.data.status).toBe('APPROVED');

      // The claim happens before any money moves — but that's provable
      // safety, not merely ordering, because a thrown failure anywhere
      // after it (see the "never leaves a false APPROVED payment" test
      // below) rolls back this ENTIRE transaction, claim included.
      expect(tx.paymentSubmission.updateMany.mock.invocationCallOrder[0])
        .toBeLessThan(tx.account.update.mock.invocationCallOrder[0]);
    },
  );

  it('links transactionId onto the payment — an APPROVED payment is never left without one', async () => {
    const { service, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    const result: any = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    expect(result.transactionId).toBe('txn-1');
    const [updateArg] = tx.paymentSubmission.update.mock.calls[0];
    expect(updateArg.data.transactionId).toBe('txn-1');
  });

  it('writes the same PAYMENT_APPROVED audit record a manual approval gets', async () => {
    const { service, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        societyId: SOCIETY_ID,
        actorId: OWNER_ID,
        action: 'PAYMENT_APPROVED',
        entityType: 'PaymentSubmission',
        entityId: PAYMENT_ID,
      }),
    });
  });

  it('notifies the resident the same way approve() does', async () => {
    const { service, notifications } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    expect(notifications.sendToUsers).toHaveBeenCalledWith(
      SOCIETY_ID,
      [OWNER_ID],
      expect.objectContaining({ type: 'PAYMENT_APPROVED' }),
    );
  });

  it('never leaves a false APPROVED payment when the financial write fails — nothing in the transaction commits', async () => {
    const { service, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    (tx.account.update as jest.Mock).mockRejectedValue(new Error('account update failed'));

    // The real guarantee here is Postgres's own transaction rollback — this
    // mock can only prove submit() propagates the failure rather than
    // swallowing it and returning something that looks like success.
    await expect(service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto)).rejects.toThrow(
      'account update failed',
    );
    expect(tx.paymentSubmission.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

/**
 * A receipt of the wrong type must be refused before anything is written. The
 * proof is stored after the payment row is created, so refusing it at that
 * point would leave a payment behind while telling the resident it failed.
 */
describe('PaymentsService.submit — idempotency (same flat, same UTR)', () => {
  it('an already-APPROVED payment is returned exactly as-is — no new row, no new financial event', async () => {
    const existing = { id: 'payment-original', status: PaymentStatus.APPROVED, transactionId: 'txn-original' };
    const { service, prisma, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    (prisma.paymentSubmission.findFirst as jest.Mock).mockResolvedValue(existing);

    const result = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    expect(result).toBe(existing);
    expect(prisma.paymentSubmission.create).not.toHaveBeenCalled();
    expect(tx.account.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it.each([PaymentStatus.REJECTED, PaymentStatus.CANCELLED])(
    'an already-%s payment is returned exactly as-is — never silently reopened by a resubmission',
    async (status) => {
      const existing = { id: 'payment-original', status };
      const { service, prisma, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
      (prisma.paymentSubmission.findFirst as jest.Mock).mockResolvedValue(existing);

      const result = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

      expect(result).toBe(existing);
      expect(prisma.paymentSubmission.create).not.toHaveBeenCalled();
      expect(tx.account.update).not.toHaveBeenCalled();
    },
  );

  it("PENDING + missing proof: a retry that supplies one attaches it to the EXISTING payment, never a new row", async () => {
    const existing = { id: 'payment-original', status: PaymentStatus.PENDING, transactionId: null, maintenanceBillId: null };
    const { service, prisma } = makeSubmitServices({ accounts: [] });
    (prisma.paymentSubmission.findFirst as jest.Mock).mockResolvedValue(existing);
    (prisma.document.findFirst as jest.Mock).mockResolvedValue(null); // no proof attached yet

    await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto, {
      originalname: 'receipt.jpg', size: 10, mimetype: 'image/jpeg', buffer: JPEG_BYTES,
    });

    expect(prisma.paymentSubmission.create).not.toHaveBeenCalled();
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ linkedEntityId: 'payment-original' }) }),
    );
  });

  it('PENDING + already has a proof: a retry that supplies another one is not attached again', async () => {
    const existing = { id: 'payment-original', status: PaymentStatus.PENDING, transactionId: null, maintenanceBillId: null };
    const { service, prisma } = makeSubmitServices({ accounts: [] });
    (prisma.paymentSubmission.findFirst as jest.Mock).mockResolvedValue(existing);
    (prisma.document.findFirst as jest.Mock).mockResolvedValue({ id: 'doc-existing' }); // already has one

    await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto, {
      originalname: 'receipt.jpg', size: 10, mimetype: 'image/jpeg', buffer: JPEG_BYTES,
    });

    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it(
    'PENDING + incomplete financial processing: a resume that now qualifies for auto-approval completes it exactly once',
    async () => {
      const existing = {
        id: 'payment-original',
        status: PaymentStatus.PENDING,
        transactionId: null,
        maintenanceBillId: BILL_ID,
        utrNumber: submitDto.utrNumber,
        amount: new Prisma.Decimal(2500),
        paymentDate: new Date('2026-09-09'),
      };
      const { service, prisma, tx, notifications } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
      (prisma.paymentSubmission.findFirst as jest.Mock).mockResolvedValue(existing);

      const result: any = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

      expect(prisma.paymentSubmission.create).not.toHaveBeenCalled(); // never a second row
      expect(tx.paymentSubmission.updateMany).toHaveBeenCalledTimes(1); // exactly one atomic claim
      expect(tx.account.update).toHaveBeenCalledTimes(1); // exactly one credit
      expect(tx.transaction.create).toHaveBeenCalledTimes(1); // exactly one ledger row
      expect(result.autoApproved).toBe(true);
      expect(notifications.sendToUsers).toHaveBeenCalledWith(
        SOCIETY_ID, [OWNER_ID], expect.objectContaining({ type: 'PAYMENT_APPROVED' }),
      );
    },
  );

  it('PENDING but no longer eligible (verification now required) resumes to exactly the same PENDING state, no error, no financial touch', async () => {
    const existing = {
      id: 'payment-original',
      status: PaymentStatus.PENDING,
      transactionId: null,
      maintenanceBillId: BILL_ID,
      utrNumber: submitDto.utrNumber,
      amount: new Prisma.Decimal(2500),
      paymentDate: new Date('2026-09-09'),
    };
    const { service, prisma, tx } = makeSubmitServices({
      accounts: [{ id: 'account-1' }],
      verificationRequired: true, // no longer auto-approve-eligible
    });
    (prisma.paymentSubmission.findFirst as jest.Mock).mockResolvedValue(existing);

    const result = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    expect(result).toBe(existing);
    expect(tx.account.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it('creates a new payment as normal when no UTR is given (cash/cheque are never deduplicated)', async () => {
    const { service, prisma, tx } = makeSubmitServices({ accounts: [] });
    await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, { ...submitDto, utrNumber: undefined, paymentMethod: 'CASH' as any });
    expect(prisma.paymentSubmission.findFirst).not.toHaveBeenCalled();
    expect(tx.paymentSubmission.create).toHaveBeenCalled();
  });

  it('creates a second, independent payment for a different UTR — a real second payment, not a retry', async () => {
    const { service, prisma, tx } = makeSubmitServices({ accounts: [] });
    await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, { ...submitDto, utrNumber: 'a-different-utr' });
    expect(prisma.paymentSubmission.findFirst).toHaveBeenCalledWith({
      where: { societyId: SOCIETY_ID, flatId: FLAT_ID, utrNumber: 'a-different-utr' },
    });
    expect(tx.paymentSubmission.create).toHaveBeenCalled();
  });

  it('falls back to the winning row when two retries race past the pre-check and the database catches it', async () => {
    const { service, prisma, tx } = makeSubmitServices({ accounts: [] });
    const raceWinner = { id: 'payment-winner' };
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    Object.setPrototypeOf(p2002, Prisma.PrismaClientKnownRequestError.prototype);
    // The write itself lives inside the transaction — this is the one that
    // actually throws when a real unique-index violation is caught.
    (tx.paymentSubmission.create as jest.Mock).mockRejectedValue(p2002);
    (prisma.paymentSubmission.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // pre-check: nothing yet, so it proceeds to create()
      .mockResolvedValueOnce(raceWinner); // after the race is caught, the other request's row

    const result = await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);
    expect(result).toBe(raceWinner);
  });

  it('re-throws a database error that is not the UTR unique-constraint violation', async () => {
    const { service, tx } = makeSubmitServices({ accounts: [] });
    (tx.paymentSubmission.create as jest.Mock).mockRejectedValue(new Error('connection lost'));
    await expect(service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto)).rejects.toThrow('connection lost');
  });
});

describe('PaymentsService.submit — unsupported receipt', () => {
  it('rejects the file before creating a payment', async () => {
    const create = jest.fn();
    const prisma = {
      societyMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
      paymentSubmission: { create },
    } as unknown as PrismaService;
    const storage = { upload: jest.fn(), getBasePath: jest.fn() } as unknown as SftpStorageService;
    const service = new PaymentsService(prisma, storage, notificationsStub(), new StoragePathService(storage));

    await expect(
      service.submit(
        SOCIETY_ID, OWNER_ID, 'flat-1',
        { amount: 500, paymentDate: '2026-01-01', paymentMethod: 'UPI' } as any,
        { originalname: 'receipt.html', size: 10, mimetype: 'text/html', buffer: Buffer.from('<script>') },
      ),
    ).rejects.toThrow('That file type is not supported');

    expect(create).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

/**
 * Payment proofs now live with the flat the payment is for:
 *   {base}/{societyId}/residents/{flatId}/payments/{uuid}-{name}
 * rather than a single society-wide payment-proofs folder.
 */
describe('PaymentsService.submit — where the proof is stored', () => {
  function setupProof(opts: { docCreateFails?: boolean } = {}) {
    const storage = {
      getBasePath: jest.fn().mockReturnValue('/ng-home-documents'),
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as SftpStorageService;
    const tx = {
      paymentSubmission: { create: jest.fn().mockResolvedValue({ id: PAYMENT_ID, status: 'PENDING' }) },
      document: {
        create: opts.docCreateFails
          ? jest.fn().mockRejectedValue(new Error('database unavailable'))
          : jest.fn().mockResolvedValue({ id: 'doc-1' }),
      },
    };
    const prisma = {
      societyMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
      maintenanceBill: { findFirst: jest.fn() },
      societyConfiguration: { findUnique: jest.fn().mockResolvedValue({ paymentVerificationRequired: true }) },
      account: { findMany: jest.fn().mockResolvedValue([]) },
      paymentSubmission: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    } as unknown as PrismaService;
    const service = new PaymentsService(prisma, storage, notificationsStub(), new StoragePathService(storage));
    return { service, storage, prisma, tx };
  }

  const receipt = { originalname: 'UPI Receipt.jpg', size: 10, mimetype: 'image/jpeg', buffer: JPEG_BYTES };
  const dto = { amount: 500, paymentDate: '2026-01-01', paymentMethod: 'UPI' } as SubmitPaymentDto;

  it("files the proof under the payment's own flat, in payments/", async () => {
    const { service, storage, tx } = setupProof();
    await service.submit(SOCIETY_ID, OWNER_ID, 'flat-10', dto, receipt);

    const [, remotePath] = (storage.upload as jest.Mock).mock.calls[0];
    expect(remotePath).toMatch(
      /^\/ng-home-documents\/society-a\/residents\/flat-10\/payments\/[0-9a-f-]{36}-UPI_Receipt\.jpg$/,
    );
    expect(remotePath).not.toContain('payment-proofs');

    // Same Document relationship as before, pointing at the new location.
    const [{ data }] = (tx.document.create as jest.Mock).mock.calls[0];
    expect(data.fileKey).toBe(remotePath);
    expect(data.fileName).toBe('UPI Receipt.jpg');
    expect(data.payments).toEqual({ connect: { id: PAYMENT_ID } });
  });

  it('removes the stored proof when its Document row cannot be written', async () => {
    const { service, storage } = setupProof({ docCreateFails: true });

    await expect(service.submit(SOCIETY_ID, OWNER_ID, 'flat-10', dto, receipt)).rejects.toThrow(
      'database unavailable',
    );
    const [, uploadedPath] = (storage.upload as jest.Mock).mock.calls[0];
    expect(storage.remove).toHaveBeenCalledWith(uploadedPath);
  });
});
