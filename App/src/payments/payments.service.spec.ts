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
    return {
      societyMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
      maintenanceBill: { findFirst: jest.fn() },
      societyConfiguration: { findUnique: jest.fn().mockResolvedValue({ paymentVerificationRequired: true }) },
      // submit() checks the society's accounts to decide whether auto-approve
      // can land the money anywhere. These cases require verification, so the
      // list is never used — it just has to exist.
      account: { findMany: jest.fn().mockResolvedValue([]) },
      paymentSubmission: { create: jest.fn().mockResolvedValue(payment) },
      document: { create: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    } as unknown as PrismaService;
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
      { originalname: 'receipt.jpg', size: 1234, mimetype: 'image/jpeg', buffer: Buffer.from('x') },
    );

    expect((storage.upload as jest.Mock)).toHaveBeenCalled();
    expect((prisma.document as any).create).toHaveBeenCalledWith(
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
    expect((prisma.document as any).create).not.toHaveBeenCalled();
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

import { Prisma } from '@prisma/client';

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

  const tx = {
    account: {
      update: jest.fn().mockResolvedValue({ id: 'account-1', currentBalance: new Prisma.Decimal(2500) }),
    },
    transaction: { create: jest.fn().mockResolvedValue({}) },
    maintenanceBill: {
      update: jest
        .fn()
        .mockResolvedValue({ ...bill, paidAmount: new Prisma.Decimal(2500), totalAmount: new Prisma.Decimal(2500) }),
    },
  };

  const prisma = {
    societyMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
    maintenanceBill: { findFirst: jest.fn().mockResolvedValue(bill) },
    societyConfiguration: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ paymentVerificationRequired: opts.verificationRequired ?? false }),
    },
    account: { findMany: jest.fn().mockResolvedValue(opts.accounts) },
    paymentSubmission: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: PAYMENT_ID, ...data })),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as unknown as PrismaService;

  const storage = {} as unknown as SftpStorageService;
  return { service: new PaymentsService(prisma, storage, notificationsStub(), new StoragePathService(storage)), prisma, tx };
}

const submitDto = {
  maintenanceBillId: BILL_ID,
  amount: 2500,
  paymentDate: '2026-09-09',
  paymentMethod: 'UPI' as any,
  utrNumber: '426117890123',
};

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

  it('increments the bill atomically rather than writing a computed total', async () => {
    const { service, tx } = makeSubmitServices({ accounts: [{ id: 'account-1' }] });
    await service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, submitDto);

    const [billArg] = tx.maintenanceBill.update.mock.calls[0];
    expect(billArg.data).toEqual({ paidAmount: { increment: expect.anything() } });
  });
});

/**
 * A receipt of the wrong type must be refused before anything is written. The
 * proof is stored after the payment row is created, so refusing it at that
 * point would leave a payment behind while telling the resident it failed.
 */
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
    const prisma = {
      societyMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
      maintenanceBill: { findFirst: jest.fn() },
      societyConfiguration: { findUnique: jest.fn().mockResolvedValue({ paymentVerificationRequired: true }) },
      account: { findMany: jest.fn().mockResolvedValue([]) },
      paymentSubmission: { create: jest.fn().mockResolvedValue({ id: PAYMENT_ID }) },
      document: {
        create: opts.docCreateFails
          ? jest.fn().mockRejectedValue(new Error('database unavailable'))
          : jest.fn().mockResolvedValue({ id: 'doc-1' }),
      },
    } as unknown as PrismaService;
    const service = new PaymentsService(prisma, storage, notificationsStub(), new StoragePathService(storage));
    return { service, storage, prisma };
  }

  const receipt = { originalname: 'UPI Receipt.jpg', size: 10, mimetype: 'image/jpeg', buffer: Buffer.from('x') };
  const dto = { amount: 500, paymentDate: '2026-01-01', paymentMethod: 'UPI' } as SubmitPaymentDto;

  it("files the proof under the payment's own flat, in payments/", async () => {
    const { service, storage, prisma } = setupProof();
    await service.submit(SOCIETY_ID, OWNER_ID, 'flat-10', dto, receipt);

    const [, remotePath] = (storage.upload as jest.Mock).mock.calls[0];
    expect(remotePath).toMatch(
      /^\/ng-home-documents\/society-a\/residents\/flat-10\/payments\/[0-9a-f-]{36}-UPI_Receipt\.jpg$/,
    );
    expect(remotePath).not.toContain('payment-proofs');

    // Same Document relationship as before, pointing at the new location.
    const [{ data }] = (prisma.document.create as jest.Mock).mock.calls[0];
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
