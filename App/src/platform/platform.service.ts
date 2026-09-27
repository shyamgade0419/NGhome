import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from '../documents/sftp-storage.service';

export type FileKind = 'images' | 'pdf' | 'office' | 'other';

export function fileKind(mimeType: string): FileKind {
  if (mimeType.startsWith('image/')) return 'images';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.includes('word') ||
    mimeType.includes('excel') ||
    mimeType.includes('spreadsheet') ||
    mimeType === 'text/csv'
  ) {
    return 'office';
  }
  return 'other';
}

/**
 * Platform-console features that don't belong to any one society: how much
 * file storage each society is using, whether the SFTP server is reachable,
 * and who the platform admins are. PlatformAdminGuard protects every route.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SftpStorageService,
  ) {}

  /**
   * Files per society, from the documents table — every upload (documents,
   * payment proofs, screenshots) is a Document row, so this is what is
   * actually on the SFTP server without listing it. Links (storageProvider
   * 'local') carry no file and are excluded. Cheap: grouped queries, no SFTP
   * connection.
   */
  async getStorageOverview() {
    const where = { storageProvider: 'sftp', isActive: true };

    const [societies, perSociety, perMime] = await Promise.all([
      this.prisma.society.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, displayName: true },
      }),
      this.prisma.document.groupBy({
        by: ['societyId'],
        where,
        _count: { _all: true },
        _sum: { fileSize: true },
      }),
      this.prisma.document.groupBy({
        by: ['mimeType'],
        where,
        _count: { _all: true },
        _sum: { fileSize: true },
      }),
    ]);

    const usage = new Map(
      perSociety.map((r) => [r.societyId, { files: r._count._all, bytes: r._sum.fileSize ?? 0 }]),
    );

    // Live societies only, so the total agrees with the table beneath it.
    const rows = societies
      .map((s) => ({
        societyId: s.id,
        name: s.displayName ?? s.name,
        files: usage.get(s.id)?.files ?? 0,
        bytes: usage.get(s.id)?.bytes ?? 0,
      }))
      .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

    const byType: Record<FileKind, { files: number; bytes: number }> = {
      images: { files: 0, bytes: 0 },
      pdf: { files: 0, bytes: 0 },
      office: { files: 0, bytes: 0 },
      other: { files: 0, bytes: 0 },
    };
    for (const r of perMime) {
      const kind = byType[fileKind(r.mimeType)];
      kind.files += r._count._all;
      kind.bytes += r._sum.fileSize ?? 0;
    }

    return {
      provider: 'sftp',
      basePath: this.storage.getBasePath(),
      totalFiles: rows.reduce((n, r) => n + r.files, 0),
      totalBytes: rows.reduce((n, r) => n + r.bytes, 0),
      byType,
      societies: rows,
    };
  }

  /**
   * Opens a real SFTP connection and does a write round trip, so it is only
   * ever called on demand (a button), never on page load, and the controller
   * rate-limits it.
   */
  async checkStorageConnection() {
    const result = await this.storage.checkStorage();
    return result.ok
      ? { ok: true as const, base: result.base, home: result.home }
      : { ok: false as const, reason: result.reason };
  }

  async listAdmins() {
    return this.prisma.user.findMany({
      where: { isPlatformAdmin: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Activate or deactivate a platform admin. Deactivation takes effect
   * straight away: the JWT strategy re-reads isActive on every request and
   * login/refresh both refuse an inactive user. An admin can't change their
   * own access — the acting admin is by definition active, so this also
   * guarantees at least one active platform admin always remains.
   */
  async setAdminActive(id: string, isActive: boolean, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('You cannot change your own access.');
    }
    const target = await this.prisma.user.findFirst({
      where: { id, isPlatformAdmin: true, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!target) throw new NotFoundException('Platform admin not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: isActive ? AuditAction.USER_MODIFIED : AuditAction.USER_DEACTIVATED,
        entityType: 'User',
        entityId: id,
        oldValues: { isActive: target.isActive } as Prisma.InputJsonValue,
        newValues: {
          isActive,
          action: isActive ? 'PLATFORM_ADMIN_REACTIVATED' : 'PLATFORM_ADMIN_DEACTIVATED',
        } as Prisma.InputJsonValue,
      },
    });

    return updated;
  }
}
