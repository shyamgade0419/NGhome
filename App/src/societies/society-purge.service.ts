import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from '../documents/sftp-storage.service';
import { StoragePathService } from '../documents/storage-path.service';
import { lowerFirst, purgeOrder } from './society-purge.plan';

export interface PurgeResult {
  id: string;
  name: string;
  /** Rows removed, by table, for the tables that had any. */
  deleted: Record<string, number>;
  usersRemoved: number;
  /** Stored files queued for removal after the database commit. */
  filesQueued: number;
}

/**
 * Permanent society delete — the counterpart to SocietiesService.softDelete,
 * which only hides a society and keeps every row.
 *
 * Everything in the database happens in one transaction: if any foreign key
 * objects, the whole purge rolls back and nothing is half-deleted. Stored
 * files are removed only after that commit, because an SFTP call must not
 * sit inside a database transaction and a rolled-back purge must not have
 * lost its files.
 */
@Injectable()
export class SocietyPurgeService {
  private readonly logger = new Logger(SocietyPurgeService.name);
  private readonly order = purgeOrder();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SftpStorageService,
    private readonly paths: StoragePathService,
  ) {}

  async purge(id: string, confirmName: string, actorId: string): Promise<PurgeResult> {
    // Includes already soft-deleted societies — that is how they get erased.
    const society = await this.prisma.society.findUnique({ where: { id } });
    if (!society) throw new NotFoundException('Society not found');

    const shownName = (society.displayName ?? society.name).trim();
    if ((confirmName ?? '').trim() !== shownName) {
      throw new BadRequestException('The name you typed does not match this society, so nothing was deleted.');
    }

    // Decided up front, while the society row still exists: only keys inside
    // this society's own storage folder are ever removed.
    const docs = await this.prisma.document.findMany({
      where: { societyId: id, storageProvider: 'sftp' },
      select: { fileKey: true },
    });
    const filesToRemove: string[] = [];
    for (const d of docs) {
      if (await this.paths.isSocietyKey(id, d.fileKey)) filesToRemove.push(d.fileKey);
    }

    // Which step the transaction is on, so a failure can say where it stopped.
    let step = 'finding the people who belong only to this society';

    let result: { deleted: Record<string, number>; usersRemoved: number };
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          // People who exist only because of this society: not a platform admin
          // and with no membership in any other society. Their accounts go with
          // it, which also frees their email addresses.
          const exclusive = await tx.user.findMany({
            where: {
              isPlatformAdmin: false,
              memberships: { some: { societyId: id }, none: { societyId: { not: id } } },
            },
            select: { id: true },
          });
          const userIds = exclusive.map((u) => u.id);

          const deleted: Record<string, number> = {};
          for (const model of this.order) {
            step = `deleting ${model} rows`;
            const delegate = (
              tx as unknown as Record<string, { deleteMany: (a: unknown) => Promise<{ count: number }> }>
            )[lowerFirst(model)];
            const { count } = await delegate.deleteMany({ where: { societyId: id } });
            if (count > 0) deleted[model] = count;
          }

          if (userIds.length > 0) {
            // Audit rows these people wrote anywhere (the actor column is
            // required, so they would otherwise block the account's removal).
            step = 'deleting audit rows written by this society’s members';
            await tx.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
            step = 'deleting the members’ accounts';
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
          }

          step = 'deleting the society itself';
          await tx.society.delete({ where: { id } });

          // The one record that survives: who erased what, and when. It carries
          // no societyId, since that society no longer exists.
          step = 'writing the audit record';
          await tx.auditLog.create({
            data: {
              societyId: null,
              actorId,
              action: AuditAction.CONFIG_CHANGED,
              entityType: 'Society',
              entityId: id,
              oldValues: { name: society.name, displayName: society.displayName } as Prisma.InputJsonValue,
              newValues: {
                action: 'SOCIETY_PURGED',
                deleted,
                usersRemoved: userIds.length,
              } as Prisma.InputJsonValue,
            },
          });

          return { deleted, usersRemoved: userIds.length };
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (err) {
      // The transaction has rolled back, so nothing was deleted. Name the
      // step and constraint instead of a bare "Foreign key constraint failed":
      // a platform admin can act on it, and so can whoever fixes the plan.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        const constraint = String((err.meta as { field_name?: unknown } | undefined)?.field_name ?? 'unknown constraint');
        this.logger.error(`Purge of society ${id} stopped while ${step}: foreign key ${constraint}. Rolled back.`);
        throw new ConflictException(
          `Nothing was deleted. The database refused while ${step}: something still refers to those rows (${constraint}).`,
        );
      }
      throw err;
    }

    void this.removeFiles(filesToRemove);

    return { id, name: shownName, ...result, filesQueued: filesToRemove.length };
  }

  /** Best-effort, one at a time; storage.remove never throws. */
  private async removeFiles(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.storage.remove(key);
    }
    if (keys.length > 0) this.logger.log(`Removed ${keys.length} stored file(s) of a purged society.`);
  }
}
