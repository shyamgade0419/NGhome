import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, AuditAction, Prisma, StaffAttendance, StaffShift } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { istDateString, istDayStartUtc, istMinutesOfDay } from '../amenities/amenity-time';
import {
  ATTENDANCE_LIMITS, Summary, addDays, dateAllowed, dateKey, dateRange, formatTime, isLate, monthDates, parseDate, parseTime, summarize, weekdayOf, workedMinutes,
} from './attendance-rules';
import { AssignRosterDto, ClearRosterDto, CreateShiftDto, MarkAttendanceDto, MarkDayDto, UpdateShiftDto } from './dto/attendance.dto';

const MINUTE = 60_000;
/** A check-in left open this long is no longer "inside": nobody records a 16 hour shift, so it is a forgotten exit. */
const OPEN_WINDOW_MS = 16 * 3_600_000;

const SELECT_STAFF = { id: true, name: true, designation: true } as const;

type RosterRow = { date: Date; shiftId: string | null; post: string | null; shift: StaffShift | null };

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Shifts ────────────────────────────────────────────────────────────────

  async listShifts(societyId: string, includeInactive = true) {
    const rows = await this.prisma.staffShift.findMany({ where: { societyId, ...(includeInactive ? {} : { active: true }) }, orderBy: [{ active: 'desc' }, { startMinute: 'asc' }] });
    return rows.map((s) => this.publicShift(s));
  }

  async createShift(societyId: string, admin: AuthenticatedUser, dto: CreateShiftDto) {
    const { startMinute, endMinute } = this.shiftTimes(dto.startTime, dto.endTime);
    try {
      const shift = await this.prisma.staffShift.create({ data: { societyId, name: dto.name, startMinute, endMinute } });
      await this.audit(societyId, admin.id, 'StaffShift', shift.id, null, { action: 'SHIFT_CREATED', name: shift.name, startTime: dto.startTime, endTime: dto.endTime });
      return this.publicShift(shift);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException(`There is already a shift called ${dto.name}.`);
      throw err;
    }
  }

  async updateShift(societyId: string, admin: AuthenticatedUser, id: string, dto: UpdateShiftDto) {
    const before = await this.prisma.staffShift.findFirst({ where: { id, societyId } });
    if (!before) throw new NotFoundException('Shift not found');
    const start = dto.startTime ?? formatTime(before.startMinute);
    const end = dto.endTime ?? formatTime(before.endMinute);
    const { startMinute, endMinute } = this.shiftTimes(start, end);
    try {
      const shift = await this.prisma.staffShift.update({
        where: { id },
        data: { ...(dto.name !== undefined ? { name: dto.name } : {}), startMinute, endMinute, ...(dto.active !== undefined ? { active: dto.active } : {}) },
      });
      await this.audit(societyId, admin.id, 'StaffShift', id, this.publicShift(before), { action: 'SHIFT_UPDATED', ...this.publicShift(shift) });
      return this.publicShift(shift);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException(`There is already a shift called ${dto.name}.`);
      throw err;
    }
  }

  // ── The people who can be rostered (no pay details) ───────────────────────

  async staff(societyId: string) {
    return this.prisma.societyEmployee.findMany({ where: { societyId, isActive: true }, select: SELECT_STAFF, orderBy: { name: 'asc' } });
  }

  // ── Roster ────────────────────────────────────────────────────────────────

  async roster(societyId: string, from: string, to: string) {
    const dates = dateRange(from, to);
    if (!dates) throw new BadRequestException(`Give a from and to date, from not after to, at most ${ATTENDANCE_LIMITS.rangeDays} days.`);
    const rows = await this.prisma.staffRoster.findMany({
      where: { societyId, date: { gte: parseDate(from)!, lte: parseDate(to)! } },
      include: { shift: true },
      orderBy: [{ date: 'asc' }],
    });
    return rows.map((r) => ({ employeeId: r.employeeId, date: dateKey(r.date), post: r.post, shift: r.shift ? this.publicShift(r.shift) : null, dayOff: r.shiftId === null }));
  }

  /**
   * Puts the chosen people on a shift (or a day off) for the chosen dates, replacing whatever was
   * planned for those days. All or nothing, in one transaction. The size is capped so one request
   * cannot become thousands of writes.
   */
  async assign(societyId: string, admin: AuthenticatedUser, dto: AssignRosterDto) {
    const range = dateRange(dto.from, dto.to);
    if (!range) throw new BadRequestException(`Give a from and to date, from not after to, at most ${ATTENDANCE_LIMITS.rangeDays} days.`);
    const today = istDateString(new Date());
    const early = dateAllowed(dto.from, today, { future: true });
    if (!early.ok) throw new BadRequestException(early.reason);

    const days = dto.weekdays?.length ? range.filter((d) => dto.weekdays!.includes(weekdayOf(d))) : range;
    if (days.length === 0) throw new BadRequestException('None of those dates fall on the weekdays you chose.');
    if (days.length * dto.employeeIds.length > ATTENDANCE_LIMITS.rosterCells) {
      throw new BadRequestException(`That is too many at once (more than ${ATTENDANCE_LIMITS.rosterCells} employee-days). Do it in smaller steps.`);
    }
    await this.requireEmployees(societyId, dto.employeeIds);
    if (dto.shiftId) {
      const shift = await this.prisma.staffShift.findFirst({ where: { id: dto.shiftId, societyId, active: true } });
      if (!shift) throw new NotFoundException('That shift does not exist, or has been retired.');
    }

    const shiftId = dto.shiftId ?? null;
    const post = shiftId ? dto.post || null : null;
    await this.prisma.$transaction(
      dto.employeeIds.flatMap((employeeId) =>
        days.map((d) =>
          this.prisma.staffRoster.upsert({
            where: { employeeId_date: { employeeId, date: parseDate(d)! } },
            create: { societyId, employeeId, date: parseDate(d)!, shiftId, post, assignedById: admin.id },
            update: { shiftId, post, assignedById: admin.id },
          }),
        ),
      ),
    );
    await this.audit(societyId, admin.id, 'StaffRoster', societyId, null, {
      action: shiftId ? 'ROSTER_ASSIGNED' : 'ROSTER_DAY_OFF',
      employees: dto.employeeIds.length,
      days: days.length,
      from: dto.from,
      to: dto.to,
      ...(shiftId ? { shiftId } : {}),
    });
    return { assigned: days.length * dto.employeeIds.length, days: days.length };
  }

  async clearRoster(societyId: string, admin: AuthenticatedUser, dto: ClearRosterDto) {
    const range = dateRange(dto.from, dto.to);
    if (!range) throw new BadRequestException(`Give a from and to date, from not after to, at most ${ATTENDANCE_LIMITS.rangeDays} days.`);
    await this.requireEmployees(societyId, dto.employeeIds, false);
    const res = await this.prisma.staffRoster.deleteMany({
      where: { societyId, employeeId: { in: dto.employeeIds }, date: { gte: parseDate(dto.from)!, lte: parseDate(dto.to)! } },
    });
    await this.audit(societyId, admin.id, 'StaffRoster', societyId, null, { action: 'ROSTER_CLEARED', cleared: res.count, from: dto.from, to: dto.to });
    return { cleared: res.count };
  }

  // ── Attendance: the committee's day ───────────────────────────────────────

  /** Every active person's day: what was planned and what was recorded. */
  async day(societyId: string, date?: string) {
    const day = date ?? istDateString(new Date());
    const d = parseDate(day);
    if (!d) throw new BadRequestException('That is not a valid date.');
    const [employees, roster, attendance] = await Promise.all([
      this.prisma.societyEmployee.findMany({ where: { societyId, isActive: true }, select: SELECT_STAFF, orderBy: { name: 'asc' } }),
      this.prisma.staffRoster.findMany({ where: { societyId, date: d }, include: { shift: true } }),
      this.prisma.staffAttendance.findMany({ where: { societyId, date: d } }),
    ]);
    const rosterOf = new Map(roster.map((r) => [r.employeeId, r]));
    const attOf = new Map(attendance.map((a) => [a.employeeId, a]));
    return {
      date: day,
      rows: employees.map((e) => {
        const r = rosterOf.get(e.id);
        const a = attOf.get(e.id);
        return {
          employeeId: e.id,
          name: e.name,
          designation: e.designation,
          shift: r?.shift ? this.publicShift(r.shift) : null,
          post: r?.post ?? null,
          dayOff: !!r && r.shiftId === null,
          attendance: a ? this.publicAttendance(a, r?.shift?.startMinute ?? null) : null,
        };
      }),
    };
  }

  /** Records or corrects one person's day. Times apply to present and half day only; marking absent or leave clears them. */
  async mark(societyId: string, admin: AuthenticatedUser, dto: MarkAttendanceDto) {
    const today = istDateString(new Date());
    const allowed = dateAllowed(dto.date, today);
    if (!allowed.ok) throw new BadRequestException(allowed.reason);
    await this.requireEmployees(societyId, [dto.employeeId]);

    const withTimes = dto.status === AttendanceStatus.PRESENT || dto.status === AttendanceStatus.HALF_DAY;
    let checkInAt: Date | null = null;
    let checkOutAt: Date | null = null;
    if (withTimes && (dto.checkIn || dto.checkOut)) {
      if (dto.checkOut && !dto.checkIn) throw new BadRequestException('A check-out needs a check-in.');
      const base = istDayStartUtc(dto.date)!;
      const inMin = parseTime(dto.checkIn)!;
      checkInAt = new Date(base.getTime() + inMin * MINUTE);
      if (dto.checkOut) {
        const outMin = parseTime(dto.checkOut)!;
        // A check-out earlier than the check-in is the next morning (a night shift).
        checkOutAt = new Date(base.getTime() + (outMin >= inMin ? outMin : outMin + 1440) * MINUTE);
      }
    }

    const date = parseDate(dto.date)!;
    const where = { employeeId_date: { employeeId: dto.employeeId, date } };
    const before = await this.prisma.staffAttendance.findUnique({ where });
    const common = { status: dto.status, markedById: admin.id, note: dto.note || null };
    // Times given: set them. Present or half day with no times: leave whatever the gate recorded.
    // Absent or leave: no times can exist, so clear any.
    const times = withTimes ? (checkInAt ? { checkInAt, checkOutAt } : {}) : { checkInAt: null, checkOutAt: null };
    const row = await this.prisma.staffAttendance.upsert({
      where,
      create: { societyId, employeeId: dto.employeeId, date, ...common, checkInAt: withTimes ? checkInAt : null, checkOutAt: withTimes ? checkOutAt : null },
      update: { ...common, ...times },
    });
    await this.audit(societyId, admin.id, 'StaffAttendance', row.id, before ? { status: before.status } : null, { action: 'ATTENDANCE_MARKED', date: dto.date, status: dto.status });
    return this.publicAttendance(row, await this.shiftStart(societyId, dto.employeeId, date));
  }

  /** "Everyone present", for example. Only the status is touched, so times already recorded at the gate stay. */
  async markDay(societyId: string, admin: AuthenticatedUser, dto: MarkDayDto) {
    const today = istDateString(new Date());
    const allowed = dateAllowed(dto.date, today);
    if (!allowed.ok) throw new BadRequestException(allowed.reason);
    const ids = dto.entries.map((e) => e.employeeId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each person can appear only once.');
    await this.requireEmployees(societyId, ids);

    const date = parseDate(dto.date)!;
    await this.prisma.$transaction(
      dto.entries.map((e) =>
        this.prisma.staffAttendance.upsert({
          where: { employeeId_date: { employeeId: e.employeeId, date } },
          create: { societyId, employeeId: e.employeeId, date, status: e.status, markedById: admin.id },
          update: {
            status: e.status,
            markedById: admin.id,
            // Absent and leave cannot have times: clear any the gate recorded rather than leave a contradiction.
            ...(e.status === 'ABSENT' || e.status === 'LEAVE' ? { checkInAt: null, checkOutAt: null } : {}),
          },
        }),
      ),
    );
    await this.audit(societyId, admin.id, 'StaffAttendance', societyId, null, { action: 'ATTENDANCE_MARKED_DAY', date: dto.date, count: dto.entries.length });
    return { marked: dto.entries.length, date: dto.date };
  }

  async summary(societyId: string, month: string) {
    const all = monthDates(month);
    if (!all) throw new BadRequestException('Give a month like 2026-10.');
    const today = istDateString(new Date());
    const dates = all.filter((d) => d <= today);
    const first = parseDate(all[0])!;
    const last = parseDate(all[all.length - 1])!;

    const employees = await this.prisma.societyEmployee.findMany({
      where: { societyId, OR: [{ isActive: true }, { exitDate: { gte: first } }] },
      select: { ...SELECT_STAFF, joinDate: true, exitDate: true },
      orderBy: { name: 'asc' },
    });
    const [attendance, roster] = await Promise.all([
      this.prisma.staffAttendance.findMany({ where: { societyId, date: { gte: first, lte: last } } }),
      this.prisma.staffRoster.findMany({ where: { societyId, date: { gte: first, lte: last } }, include: { shift: true } }),
    ]);

    const rows = employees.map((e) => ({
      employeeId: e.id,
      name: e.name,
      designation: e.designation,
      ...this.monthSummary(e, dates, attendance.filter((a) => a.employeeId === e.id), roster.filter((r) => r.employeeId === e.id)),
    }));
    return { month, through: dates[dates.length - 1] ?? null, rows };
  }

  /** One person's month, day by day, with the same counts. */
  async employeeMonth(societyId: string, employeeId: string, month: string) {
    const all = monthDates(month);
    if (!all) throw new BadRequestException('Give a month like 2026-10.');
    const e = await this.prisma.societyEmployee.findFirst({ where: { id: employeeId, societyId }, select: { ...SELECT_STAFF, joinDate: true, exitDate: true } });
    if (!e) throw new NotFoundException('Employee not found');
    const first = parseDate(all[0])!;
    const last = parseDate(all[all.length - 1])!;
    const [attendance, roster] = await Promise.all([
      this.prisma.staffAttendance.findMany({ where: { societyId, employeeId, date: { gte: first, lte: last } } }),
      this.prisma.staffRoster.findMany({ where: { societyId, employeeId, date: { gte: first, lte: last } }, include: { shift: true } }),
    ]);
    const attOf = new Map(attendance.map((a) => [dateKey(a.date), a]));
    const rosterOf = new Map(roster.map((r) => [dateKey(r.date), r]));
    const today = istDateString(new Date());
    return {
      employee: { id: e.id, name: e.name, designation: e.designation },
      month,
      summary: this.monthSummary(e, all.filter((d) => d <= today), attendance, roster),
      days: all.map((d) => {
        const a = attOf.get(d);
        const r = rosterOf.get(d);
        return {
          date: d,
          shift: r?.shift ? this.publicShift(r.shift) : null,
          post: r?.post ?? null,
          dayOff: !!r && r.shiftId === null,
          attendance: a ? this.publicAttendance(a, r?.shift?.startMinute ?? null) : null,
        };
      }),
    };
  }

  // ── Gate: the guard checks staff in and out ───────────────────────────────

  /** Today's staff, for the guard: name, post and shift, and whether they are in. Never pay details or a phone number. */
  async gateStaff(societyId: string) {
    const now = new Date();
    const today = istDateString(now);
    const todayD = parseDate(today)!;
    const yesterdayD = parseDate(addDays(today, -1))!;
    const [employees, roster, attendance] = await Promise.all([
      this.prisma.societyEmployee.findMany({ where: { societyId, isActive: true }, select: SELECT_STAFF, orderBy: { name: 'asc' } }),
      this.prisma.staffRoster.findMany({ where: { societyId, date: todayD }, include: { shift: true } }),
      this.prisma.staffAttendance.findMany({ where: { societyId, date: { in: [yesterdayD, todayD] } } }),
    ]);
    const rosterOf = new Map(roster.map((r) => [r.employeeId, r]));
    const rows = employees.map((e) => {
      const r = rosterOf.get(e.id);
      const mine = attendance.filter((a) => a.employeeId === e.id);
      // Today's record; failing that, a night shift still open from yesterday.
      const a = mine.find((x) => dateKey(x.date) === today) ?? mine.find((x) => this.isOpen(x, now));
      return {
        employeeId: e.id,
        name: e.name,
        designation: e.designation,
        shiftName: r?.shift?.name ?? null,
        shiftStart: r?.shift ? formatTime(r.shift.startMinute) : null,
        shiftEnd: r?.shift ? formatTime(r.shift.endMinute) : null,
        post: r?.post ?? null,
        dayOff: !!r && r.shiftId === null,
        status: a?.status ?? null,
        checkInAt: a?.checkInAt ?? null,
        checkOutAt: a?.checkOutAt ?? null,
        inside: !!a && this.isOpen(a, now),
      };
    });
    // On duty today first, then the rest, each alphabetical.
    return rows.sort((x, y) => Number(!!y.shiftName) - Number(!!x.shiftName) || x.name.localeCompare(y.name));
  }

  /**
   * Checks a person in for today. Safe to repeat: a second check-in returns the first. If the
   * committee had already marked the day (say absent, or half day) the guard's check-in adds the time
   * and turns absent or leave into present, because the person is plainly here; a half day stays one.
   */
  async checkIn(societyId: string, guard: AuthenticatedUser, employeeId: string) {
    await this.requireEmployees(societyId, [employeeId]);
    const now = new Date();
    const today = istDateString(now);
    const date = parseDate(today)!;
    const start = await this.shiftStart(societyId, employeeId, date);

    try {
      const row = await this.prisma.staffAttendance.create({
        data: { societyId, employeeId, date, status: AttendanceStatus.PRESENT, checkInAt: now, checkedInById: guard.id },
      });
      await this.audit(societyId, guard.id, 'StaffAttendance', row.id, null, { action: 'STAFF_CHECKED_IN', date: today });
      return { attendance: this.publicAttendance(row, start), alreadyIn: false };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }

    const existing = await this.prisma.staffAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId, date } } });
    if (existing.checkInAt) return { attendance: this.publicAttendance(existing, start), alreadyIn: true };

    // The day was marked without a time; this adds it. Only one request can win the "no time yet" claim.
    const claimed = await this.prisma.staffAttendance.updateMany({
      where: { id: existing.id, checkInAt: null },
      data: { checkInAt: now, checkedInById: guard.id, status: existing.status === AttendanceStatus.HALF_DAY ? AttendanceStatus.HALF_DAY : AttendanceStatus.PRESENT },
    });
    const row = await this.prisma.staffAttendance.findUniqueOrThrow({ where: { id: existing.id } });
    if (claimed.count > 0) {
      await this.audit(societyId, guard.id, 'StaffAttendance', row.id, { status: existing.status }, { action: 'STAFF_CHECKED_IN', date: today, over: existing.status });
    }
    return { attendance: this.publicAttendance(row, start), alreadyIn: claimed.count === 0 };
  }

  /**
   * Records the exit of the person's open check-in (today's, or last night's for a night shift): one
   * atomic update that only succeeds while the exit is blank, so pressing twice, or two guards at
   * once, records it once.
   */
  async checkOut(societyId: string, guard: AuthenticatedUser, employeeId: string) {
    await this.requireEmployees(societyId, [employeeId]);
    const now = new Date();
    const today = istDateString(now);
    const since = parseDate(addDays(today, -1))!;

    const open = await this.prisma.staffAttendance.findFirst({
      where: { societyId, employeeId, date: { gte: since }, checkInAt: { gte: new Date(now.getTime() - OPEN_WINDOW_MS) }, checkOutAt: null },
      orderBy: { date: 'desc' },
    });
    if (!open) {
      const latest = await this.prisma.staffAttendance.findFirst({ where: { societyId, employeeId, date: { gte: since }, checkInAt: { not: null } }, orderBy: { checkInAt: 'desc' } });
      if (latest?.checkOutAt) return { attendance: this.publicAttendance(latest, null), alreadyOut: true };
      throw new ConflictException('This person has not been checked in, so they cannot be checked out.');
    }
    const claimed = await this.prisma.staffAttendance.updateMany({ where: { id: open.id, checkOutAt: null }, data: { checkOutAt: now, checkedOutById: guard.id } });
    const row = await this.prisma.staffAttendance.findUniqueOrThrow({ where: { id: open.id } });
    if (claimed.count > 0) await this.audit(societyId, guard.id, 'StaffAttendance', row.id, { checkOutAt: null }, { action: 'STAFF_CHECKED_OUT', date: dateKey(row.date) });
    return { attendance: this.publicAttendance(row, await this.shiftStart(societyId, employeeId, row.date)), alreadyOut: claimed.count === 0 };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private isOpen(a: Pick<StaffAttendance, 'checkInAt' | 'checkOutAt'>, now: Date): boolean {
    return !!a.checkInAt && !a.checkOutAt && now.getTime() - a.checkInAt.getTime() < OPEN_WINDOW_MS;
  }

  private shiftTimes(startTime: string, endTime: string) {
    const startMinute = parseTime(startTime);
    const endMinute = parseTime(endTime);
    if (startMinute === null || endMinute === null) throw new BadRequestException('Times must look like 06:00.');
    if (startMinute === endMinute) throw new BadRequestException('A shift cannot start and end at the same time.');
    return { startMinute, endMinute };
  }

  /** Everyone named must be a person of this society, and (for changes) still employed. */
  private async requireEmployees(societyId: string, ids: string[], mustBeActive = true) {
    const found = await this.prisma.societyEmployee.count({ where: { societyId, id: { in: ids }, ...(mustBeActive ? { isActive: true } : {}) } });
    if (found !== new Set(ids).size) throw new NotFoundException(mustBeActive ? 'One of those people is not an active employee of this society.' : 'One of those people is not an employee of this society.');
  }

  private async shiftStart(societyId: string, employeeId: string, date: Date): Promise<number | null> {
    const r = await this.prisma.staffRoster.findFirst({ where: { societyId, employeeId, date }, include: { shift: true } });
    return r?.shift?.startMinute ?? null;
  }

  private monthSummary(
    e: { joinDate: Date | null; exitDate: Date | null },
    dates: string[],
    attendance: StaffAttendance[],
    roster: RosterRow[],
  ): Summary {
    return summarize({
      dates,
      joinDate: e.joinDate ? istDateString(e.joinDate) : null,
      exitDate: e.exitDate ? istDateString(e.exitDate) : null,
      attendance: new Map(
        attendance.map((a) => [dateKey(a.date), { status: a.status, checkInMinuteOfDay: a.checkInAt ? istMinutesOfDay(a.checkInAt) : null, worked: workedMinutes(a.checkInAt, a.checkOutAt) }]),
      ),
      roster: new Map(roster.map((r) => [dateKey(r.date), { shiftStartMinute: r.shift?.startMinute ?? null }])),
    });
  }

  private publicShift(s: StaffShift) {
    return { id: s.id, name: s.name, startTime: formatTime(s.startMinute), endTime: formatTime(s.endMinute), startMinute: s.startMinute, endMinute: s.endMinute, overnight: s.endMinute < s.startMinute, active: s.active };
  }

  private publicAttendance(a: StaffAttendance, shiftStartMinute: number | null) {
    return {
      employeeId: a.employeeId,
      date: dateKey(a.date),
      status: a.status,
      checkInAt: a.checkInAt,
      checkOutAt: a.checkOutAt,
      note: a.note,
      workedMinutes: workedMinutes(a.checkInAt, a.checkOutAt),
      late: !!a.checkInAt && shiftStartMinute !== null && (a.status === 'PRESENT' || a.status === 'HALF_DAY') && isLate(shiftStartMinute, istMinutesOfDay(a.checkInAt)),
    };
  }

  private async audit(
    societyId: string,
    actorId: string,
    entityType: string,
    entityId: string,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        societyId,
        actorId,
        action: AuditAction.OTHER,
        entityType,
        entityId,
        ...(oldValues ? { oldValues: oldValues as Prisma.InputJsonValue } : {}),
        newValues: newValues as Prisma.InputJsonValue,
      },
    });
  }
}
