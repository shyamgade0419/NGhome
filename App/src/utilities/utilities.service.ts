import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UtilityConnection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ELECTRICITY_PROVIDERS, OTHER_PROVIDER, providerByCode } from './utility-providers';
import { DEFAULT_REMINDER_DAY, cleanConsumerNumber, nextReminderDate } from './utility-reminders';

/** A flat has a handful of connections at most (a main meter, a common area, a second home): more is a mistake. */
export const MAX_PER_FLAT = 5;

export interface ConnectionInput {
  providerCode: string;
  /** Required for OTHER: the company's name. */
  providerName?: string;
  /** Optional for OTHER: the company's own https website to pay on. */
  providerUrl?: string;
  consumerNumber: string;
  nickname?: string;
  reminderDay?: number;
  remindersOn?: boolean;
}

export interface ConnectionView {
  id: string;
  providerCode: string;
  providerName: string;
  providerUrl: string | null;
  consumerNumber: string;
  nickname: string | null;
  reminderDay: number;
  remindersOn: boolean;
  /** "YYYY-MM-DD" of the next reminder, or null while reminders are off. */
  nextReminder: string | null;
}

const toView = (c: UtilityConnection, now = new Date()): ConnectionView => ({
  id: c.id,
  providerCode: c.providerCode,
  providerName: c.providerName,
  providerUrl: c.providerUrl,
  consumerNumber: c.consumerNumber,
  nickname: c.nickname,
  reminderDay: c.reminderDay,
  remindersOn: c.remindersOn,
  nextReminder: c.remindersOn ? nextReminderDate(now, c.reminderDay, c.lastRemindedMonth) : null,
});

/** An https link with a real host and nothing hidden in it (no login in the address), or a refusal in plain words. */
function cleanUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new BadRequestException('That website address does not look right. It should start with https://');
  }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password || raw.length > 300) {
    throw new BadRequestException('Use the company\'s own website address, starting with https://');
  }
  return u.toString();
}

/**
 * A flat's electricity connections: the company and the consumer number, kept so the residents are reminded each month to check
 * and pay the bill. Nothing is fetched from the company and nothing is paid here; "pay" opens the company's own website. Every
 * call works on the caller's own flat in the caller's society, so no request can name another flat's connection.
 */
@Injectable()
export class UtilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  providers() {
    return { electricity: ELECTRICITY_PROVIDERS, defaultReminderDay: DEFAULT_REMINDER_DAY };
  }

  /** The caller's flat, or a refusal when they have none (an admin who does not live in the society, for example). */
  private async flatOf(societyId: string, userId: string, flatId: string | null | undefined): Promise<string> {
    if (!flatId) throw new ForbiddenException('Connections belong to a flat, and your account has none.');
    const m = await this.prisma.societyMembership.findFirst({ where: { societyId, userId, flatId, status: 'ACTIVE' }, select: { id: true } });
    if (!m) throw new ForbiddenException('That flat is not assigned to your account.');
    return flatId;
  }

  async list(societyId: string, userId: string, flatId: string | null | undefined): Promise<ConnectionView[]> {
    const flat = await this.flatOf(societyId, userId, flatId);
    const rows = await this.prisma.utilityConnection.findMany({ where: { societyId, flatId: flat }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => toView(r));
  }

  private resolveProvider(input: Pick<ConnectionInput, 'providerCode' | 'providerName' | 'providerUrl'>) {
    if (input.providerCode === OTHER_PROVIDER) {
      const name = input.providerName?.trim();
      if (!name) throw new BadRequestException('Enter the name of your electricity company.');
      return { providerCode: OTHER_PROVIDER, providerName: name, providerUrl: input.providerUrl ? cleanUrl(input.providerUrl) : null };
    }
    const p = providerByCode(input.providerCode);
    if (!p) throw new BadRequestException('Choose your electricity company from the list, or choose Other.');
    return { providerCode: p.code, providerName: p.name, providerUrl: p.url };
  }

  async create(societyId: string, userId: string, flatId: string | null | undefined, input: ConnectionInput): Promise<ConnectionView> {
    const flat = await this.flatOf(societyId, userId, flatId);
    const number = cleanConsumerNumber(input.consumerNumber);
    if ((await this.prisma.utilityConnection.count({ where: { societyId, flatId: flat } })) >= MAX_PER_FLAT) {
      throw new BadRequestException(`A flat can save up to ${MAX_PER_FLAT} connections. Remove one you no longer use first.`);
    }
    const provider = this.resolveProvider(input);
    try {
      const row = await this.prisma.utilityConnection.create({
        data: {
          societyId,
          flatId: flat,
          addedById: userId,
          ...provider,
          consumerNumber: number,
          nickname: input.nickname?.trim() || null,
          reminderDay: input.reminderDay ?? DEFAULT_REMINDER_DAY,
          remindersOn: input.remindersOn ?? true,
        },
      });
      return toView(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('That consumer number is already saved for your flat.');
      }
      throw err;
    }
  }

  private async mine(societyId: string, userId: string, flatId: string | null | undefined, id: string) {
    const flat = await this.flatOf(societyId, userId, flatId);
    const row = await this.prisma.utilityConnection.findFirst({ where: { id, societyId, flatId: flat } });
    if (!row) throw new NotFoundException('Connection not found');
    return row;
  }

  async update(societyId: string, userId: string, flatId: string | null | undefined, id: string, input: Partial<ConnectionInput>): Promise<ConnectionView> {
    const row = await this.mine(societyId, userId, flatId, id);
    const data: Prisma.UtilityConnectionUpdateInput = {};
    if (input.providerCode !== undefined) {
      Object.assign(data, this.resolveProvider({ providerCode: input.providerCode, providerName: input.providerName, providerUrl: input.providerUrl }));
    } else if (row.providerCode === OTHER_PROVIDER && (input.providerName !== undefined || input.providerUrl !== undefined)) {
      Object.assign(data, this.resolveProvider({ providerCode: OTHER_PROVIDER, providerName: input.providerName ?? row.providerName, providerUrl: input.providerUrl ?? row.providerUrl ?? undefined }));
    }
    if (input.consumerNumber !== undefined) data.consumerNumber = cleanConsumerNumber(input.consumerNumber);
    if (input.nickname !== undefined) data.nickname = input.nickname.trim() || null;
    if (input.reminderDay !== undefined) data.reminderDay = input.reminderDay;
    if (input.remindersOn !== undefined) data.remindersOn = input.remindersOn;
    try {
      return toView(await this.prisma.utilityConnection.update({ where: { id: row.id }, data }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('That consumer number is already saved for your flat.');
      }
      throw err;
    }
  }

  async remove(societyId: string, userId: string, flatId: string | null | undefined, id: string): Promise<{ removed: true }> {
    const row = await this.mine(societyId, userId, flatId, id);
    await this.prisma.utilityConnection.delete({ where: { id: row.id } });
    return { removed: true };
  }
}
