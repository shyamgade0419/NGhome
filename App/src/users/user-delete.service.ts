import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What happens to each row that points at a user when that user is erased.
 *
 *   cascade — the database removes it with the user (ON DELETE CASCADE)
 *   delete  — personal to the person; removed by this service first
 *   null    — optional pointer; cleared so the row survives without the person
 *   record  — the society's own history (money, notices, requests, posts).
 *             It is NOT erased with a person: while any exists, the delete is
 *             refused and says what is in the way.
 *
 * user-delete.plan.spec.ts checks this table against the Prisma schema, so a
 * table added later that points at User cannot be silently missed.
 */
export type UserRefAction = 'cascade' | 'delete' | 'null' | 'record';

export const USER_REFERENCES: Record<string, { action: UserRefAction; label: string }> = {
  'RefreshToken.userId': { action: 'cascade', label: 'sign-in sessions' },
  'PushToken.userId': { action: 'cascade', label: 'phone notification registrations' },
  'PasswordResetToken.userId': { action: 'cascade', label: 'password reset links' },
  'SocietyMembership.userId': { action: 'cascade', label: 'society memberships' },
  'ConversationParticipant.userId': { action: 'cascade', label: 'conversation memberships' },
  'NotificationRecord.userId': { action: 'delete', label: 'notifications sent to them' },
  'DirectMessage.senderId': { action: 'delete', label: 'direct messages they sent' },
  'AuditLog.actorId': { action: 'delete', label: 'audit entries for actions they took' },
  'MaintenanceRequest.assignedToId': { action: 'null', label: 'maintenance requests assigned to them' },
  'Expense.createdById': { action: 'record', label: 'expenses they recorded' },
  'Expense.approvedById': { action: 'record', label: 'expenses they approved' },
  'PaymentSubmission.userId': { action: 'record', label: 'payments they submitted' },
  'Announcement.createdById': { action: 'record', label: 'announcements they posted' },
  'Meeting.createdById': { action: 'record', label: 'meetings they created' },
  'Event.createdById': { action: 'record', label: 'events they created' },
  'Document.uploadedById': { action: 'record', label: 'documents they uploaded' },
  'MaintenanceRequest.residentId': { action: 'record', label: 'maintenance requests they raised' },
  'MaintenanceRequestComment.authorId': { action: 'record', label: 'maintenance comments they wrote' },
  'ForumTopic.createdById': { action: 'record', label: 'forum topics they started' },
  'ForumReply.authorId': { action: 'record', label: 'forum replies they wrote' },
  'AmenityBooking.userId': { action: 'record', label: 'amenity bookings' },
};

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export interface CountLine {
  label: string;
  count: number;
}

export interface UserDeletionPreview {
  user: { id: string; name: string; email: string; phone: string | null; isActive: boolean; isPlatformAdmin: boolean };
  memberships: { society: string; role: string; status: string }[];
  /** Personal rows that will be removed together with the account. */
  willRemove: CountLine[];
  /** Society history that belongs to this person and stops the delete. */
  blockedBy: CountLine[];
  /** Other reasons the delete is refused (yourself, a society's only admin, …). */
  reasons: string[];
  canDelete: boolean;
}

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Narrows a delete to one society's admin: the person must belong to that
 * society, and to no other, so nothing outside it can be reached or erased.
 */
export interface DeleteScope {
  societyId: string;
}

const maskedEmail = (email: string): string => {
  const at = email.indexOf('@');
  return at < 1 ? '***' : email.slice(0, Math.min(2, at)) + '***' + email.slice(at);
};

/**
 * Permanent delete of one account — what the platform admin needs when a
 * person was "removed" from a society (which only ends their membership and
 * leaves the account, and so their email and phone, taken) or has to be erased
 * outright. The account is only erased when nothing of the society's history
 * hangs on it; otherwise the answer is a clear list of what is in the way.
 */
@Injectable()
export class UserDeleteService {
  private readonly logger = new Logger(UserDeleteService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async count(db: Db, key: string, userId: string): Promise<number> {
    const [model, field] = key.split('.');
    const delegate = (db as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[lowerFirst(model)];
    return delegate.count({ where: { [field]: userId } });
  }

  private async assess(db: Db, userId: string, actorId: string, scope?: DeleteScope): Promise<UserDeletionPreview> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        isActive: true,
        isPlatformAdmin: true,
        memberships: {
          select: { role: true, status: true, societyId: true, society: { select: { name: true, displayName: true, deletedAt: true } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    // A society admin only ever sees people of their own society; anyone else
    // is "not found", whether or not the account exists elsewhere.
    if (scope && !user.memberships.some((m) => m.societyId === scope.societyId)) {
      throw new NotFoundException('Member not found');
    }

    const willRemove: CountLine[] = [];
    const blockedBy: CountLine[] = [];
    for (const [key, ref] of Object.entries(USER_REFERENCES)) {
      if (ref.action === 'cascade' && key.startsWith('SocietyMembership')) continue; // shown as memberships
      const n = await this.count(db, key, userId);
      if (n === 0) continue;
      (ref.action === 'record' ? blockedBy : willRemove).push({ label: ref.label, count: n });
    }

    const reasons: string[] = [];
    if (userId === actorId) reasons.push('You cannot delete your own account.');

    if (scope) {
      if (user.isPlatformAdmin) reasons.push('Platform admins cannot be deleted from a society.');
      // Erasing the account would also take them out of every other society,
      // which is not this admin's call (and must not be learnt from here).
      if (user.memberships.some((m) => m.societyId !== scope.societyId)) {
        reasons.push(
          'This person also belongs to another society, so their account cannot be deleted from here. Remove them from your society instead.',
        );
      }
    }

    // A live society must not be left with nobody to run it.
    for (const m of user.memberships) {
      if (scope && m.societyId !== scope.societyId) continue;
      if (m.status !== 'ACTIVE' || m.role !== 'SOCIETY_ADMIN' || m.society.deletedAt) continue;
      const others = await db.societyMembership.count({
        where: { societyId: m.societyId, role: 'SOCIETY_ADMIN', status: 'ACTIVE', userId: { not: userId } },
      });
      if (others === 0) {
        const name = m.society.displayName ?? m.society.name;
        reasons.push(`They are the only admin of ${name}. Make someone else an admin first, or delete the society.`);
      }
    }
    if (user.isPlatformAdmin && !scope) {
      const others = await db.user.count({
        where: { isPlatformAdmin: true, isActive: true, deletedAt: null, id: { not: userId } },
      });
      if (others === 0) reasons.push('They are the only active platform admin.');
    }

    return {
      user: {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        phone: user.phone,
        isActive: user.isActive,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      memberships: user.memberships
        .filter((m) => !scope || m.societyId === scope.societyId)
        .map((m) => ({
        society: m.society.displayName ?? m.society.name,
        role: m.role,
        status: m.status,
      })),
      willRemove,
      blockedBy,
      reasons,
      canDelete: reasons.length === 0 && blockedBy.length === 0,
    };
  }

  preview(userId: string, actorId: string, scope?: DeleteScope): Promise<UserDeletionPreview> {
    return this.assess(this.prisma, userId, actorId, scope);
  }

  async deleteUser(userId: string, confirmEmail: string, actorId: string, scope?: DeleteScope) {
    let step = 'checking the account';
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const p = await this.assess(tx, userId, actorId, scope);

          if ((confirmEmail ?? '').trim().toLowerCase() !== p.user.email.toLowerCase()) {
            throw new BadRequestException('The email you typed does not match this account, so nothing was deleted.');
          }
          if (p.reasons.length > 0) throw new BadRequestException(p.reasons.join(' '));
          if (p.blockedBy.length > 0) {
            const what = p.blockedBy.map((b) => `${b.label}: ${b.count}`).join(', ');
            throw new ConflictException(
              `Nothing was deleted. This person still has society records on file (${what}). ` +
                'Those belong to the society’s history, so the account is kept. Deactivate it instead, or delete the society.',
            );
          }

          step = 'clearing assignments';
          await tx.maintenanceRequest.updateMany({ where: { assignedToId: userId }, data: { assignedToId: null } });
          step = 'deleting their notifications';
          await tx.notificationRecord.deleteMany({ where: { userId } });
          step = 'deleting their direct messages';
          await tx.directMessage.deleteMany({ where: { senderId: userId } });
          step = 'deleting audit entries for their actions';
          await tx.auditLog.deleteMany({ where: { actorId: userId } });
          step = 'deleting the account';
          await tx.user.delete({ where: { id: userId } });

          // The one record that survives: who erased an account, and when. A
          // platform admin's record names the person (accountability across
          // societies). A society admin's keeps no personal details at all —
          // only a masked address, so a deleted resident leaves no profile
          // behind, while "an admin deleted an account on this date" stays.
          step = 'writing the audit record';
          await tx.auditLog.create({
            data: {
              societyId: scope?.societyId ?? null,
              actorId,
              action: AuditAction.USER_DELETED,
              entityType: 'User',
              entityId: userId,
              oldValues: (scope
                ? { email: maskedEmail(p.user.email) }
                : {
                    name: p.user.name,
                    email: p.user.email,
                    phone: p.user.phone,
                    isPlatformAdmin: p.user.isPlatformAdmin,
                    memberships: p.memberships,
                  }) as unknown as Prisma.InputJsonValue,
              newValues: { action: 'USER_DELETED_PERMANENTLY', removed: p.willRemove } as unknown as Prisma.InputJsonValue,
            },
          });

          return { id: userId, name: p.user.name, email: p.user.email, removed: p.willRemove };
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        const constraint = String((err.meta as { field_name?: unknown } | undefined)?.field_name ?? 'unknown constraint');
        this.logger.error(`Delete of user ${userId} stopped while ${step}: foreign key ${constraint}. Rolled back.`);
        throw new ConflictException(
          `Nothing was deleted. The database refused while ${step}: something still refers to this account (${constraint}).`,
        );
      }
      throw err;
    }
  }
}
