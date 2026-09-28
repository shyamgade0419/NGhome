import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from '../documents/sftp-storage.service';
import { AuthService } from '../auth/auth.service';
import { PricingMode, UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { InvitePlatformAdminDto } from './dto/invite-platform-admin.dto';

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

const SETTINGS_ID = 'singleton';
const DEFAULT_SUPPORT_MESSAGE = "If NG Home helps you, you can buy me a coffee — it's completely optional.";
const DEFAULT_PAYEE_NAME = 'NG Home';

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
    private readonly authService: AuthService,
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

  /** The single settings row; the defaults (free, no support prompt) until one is saved. */
  async getSettings() {
    const row = await this.prisma.platformSettings.findUnique({ where: { id: SETTINGS_ID } });
    return {
      pricingMode: (row?.pricingMode ?? 'FREE') as PricingMode,
      supportEnabled: row?.supportEnabled ?? false,
      supportUpiId: row?.supportUpiId ?? null,
      supportPayeeName: row?.supportPayeeName ?? null,
      supportMessage: row?.supportMessage ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async updateSettings(dto: UpdatePlatformSettingsDto, actorId: string) {
    const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
    const upi = clean(dto.supportUpiId);

    // The prompt is useless — and would show users a broken pay button —
    // without somewhere to send the money.
    if (dto.supportEnabled && !upi) {
      throw new BadRequestException('Add your UPI ID before turning the support prompt on.');
    }

    const before = await this.getSettings();
    const data = {
      pricingMode: dto.pricingMode,
      supportEnabled: dto.supportEnabled,
      supportUpiId: upi,
      supportPayeeName: clean(dto.supportPayeeName),
      supportMessage: clean(dto.supportMessage),
      updatedById: actorId,
    };
    await this.prisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: AuditAction.CONFIG_CHANGED,
        entityType: 'PlatformSettings',
        entityId: SETTINGS_ID,
        oldValues: {
          pricingMode: before.pricingMode,
          supportEnabled: before.supportEnabled,
          supportUpiId: before.supportUpiId,
        } as Prisma.InputJsonValue,
        newValues: {
          pricingMode: data.pricingMode,
          supportEnabled: data.supportEnabled,
          supportUpiId: data.supportUpiId,
        } as Prisma.InputJsonValue,
      },
    });

    return this.getSettings();
  }

  /**
   * What the apps show every signed-in user: whether to display the optional
   * support prompt and where it pays. Deliberately minimal — the prompt only
   * exists when it is switched on AND has a UPI ID, so a half-configured
   * setting can never render a broken button.
   */
  async getSupportInfo() {
    const s = await this.getSettings();
    const active = s.supportEnabled && !!s.supportUpiId;
    return {
      pricingMode: s.pricingMode,
      support: active
        ? {
            upiId: s.supportUpiId as string,
            payeeName: s.supportPayeeName ?? DEFAULT_PAYEE_NAME,
            message: s.supportMessage ?? DEFAULT_SUPPORT_MESSAGE,
          }
        : null,
    };
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
   * Creates a new platform admin and emails them a link to set their own
   * first password — the same "set your password" link and token model
   * forgotPassword() uses. Nobody but the new admin ever sees or chooses
   * that password: the row is created with a random, unusable hash (its
   * argon2 encoding is never compared against because no login attempt can
   * reach it before the reset link replaces it), so this cannot be used to
   * hand someone a working password out of band.
   */
  async inviteAdmin(dto: InvitePlatformAdminDto, actorId: string) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(
        existing.isPlatformAdmin
          ? 'That email is already a platform admin.'
          : 'That email is already used by another account.',
      );
    }

    const unusablePassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await argon2.hash(unusablePassword);

    const admin = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        isPlatformAdmin: true,
        isActive: true,
        emailVerified: false,
      },
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

    await this.authService.issuePasswordResetLink(admin.id, admin.email);

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: AuditAction.USER_CREATED,
        entityType: 'User',
        entityId: admin.id,
        newValues: { email, isPlatformAdmin: true } as Prisma.InputJsonValue,
      },
    });

    return admin;
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
