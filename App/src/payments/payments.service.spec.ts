/**
 * Payment proof upload/retrieval — residents had nowhere to attach a
 * receipt/screenshot for admin to verify, and even after wiring an upload
 * path in, retrieval needed a rule the generic Document accessLevel system
 * can't express: the specific payment's own submitter, plus any reviewer,
 * regardless of whose flat the reviewer happens to live on.
 */

import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from '../documents/sftp-storage.service';
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

  return { prisma, storage, service: new PaymentsService(prisma, storage) };
}

describe('PaymentsService.getProofFile', () => {
  const doc = { id: 'doc-1', fileKey: 'path/to/file.jpg', fileName: 'receipt.jpg', mimeType: 'image/jpeg' };

  it('lets the payment owner download their own proof', async () => {
    const { service, storage } = makeServices([doc]);
    const result = await service.getProofFile(SOCIETY_ID, PAYMENT_ID, { id: OWNER_ID, isReviewer: false });
    expect(result.fileName).toBe('receipt.jpg');
    expect((storage.download as jest.Mock)).toHaveBeenCalledWith('path/to/file.jpg');
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
    const service = new PaymentsService(prisma, storage);

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
    const service = new PaymentsService(prisma, storage);

    await service.submit(
      SOCIETY_ID, OWNER_ID, 'flat-1',
      { amount: 500, paymentDate: '2026-01-01', paymentMethod: 'CASH' } as any,
    );

    expect((storage.upload as jest.Mock)).not.toHaveBeenCalled();
    expect((prisma.document as any).create).not.toHaveBeenCalled();
  });
});
