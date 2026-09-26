import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSocietyDto } from './dto/create-society.dto';
import { UpdateSocietyConfigDto } from './dto/update-society-config.dto';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { generateUniqueJoinCode } from '../common/utils/join-code.util';
import { Prisma, AuditAction } from '@prisma/client';

@Injectable()
export class SocietiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSocietyDto, creatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const society = await tx.society.create({
        data: {
          name: dto.name,
          displayName: dto.displayName,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
          email: dto.email,
          phone: dto.phone,
          configuration: {
            create: {}, // Default configuration
          },
        },
      });

      // Add creator as Society Admin
      await tx.societyMembership.create({
        data: {
          societyId: society.id,
          userId: creatorId,
          role: 'SOCIETY_ADMIN',
          isPrimary: false,
          status: 'ACTIVE',
        },
      });

      return society;
    });
  }

  async findAll(page: number, limit: number) {
    const { skip, take } = getPaginationParams({ page, limit });
    const [data, total] = await Promise.all([
      this.prisma.society.findMany({
        skip,
        take,
        where: { deletedAt: null },
        include: {
          _count: { select: { memberships: true, buildings: true } },
          // Platform admin needs a real human to call, not just a member
          // count — this is the whole point of a platform-admin view: who
          // do we reach out to for this society (billing, support, etc).
          memberships: {
            where: { role: 'SOCIETY_ADMIN', status: 'ACTIVE' },
            select: {
              user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.society.count({ where: { deletedAt: null } }),
    ]);

    return {
      data: data.map(({ memberships, ...society }) => ({
        ...society,
        admins: memberships.map((m) => m.user),
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findOne(id: string) {
    const society = await this.prisma.society.findUnique({
      where: { id, deletedAt: null },
      include: {
        configuration: true,
        _count: {
          select: { memberships: true, buildings: true },
        },
      },
    });
    if (!society) throw new NotFoundException('Society not found');
    return society;
  }

  /**
   * Platform-admin only — deliberately separate from findOne(), which is
   * also called by GET /societies/my for any authenticated member. Mixing
   * the admin-contact list into findOne() would have leaked a society's
   * admin phone/email to every resident calling that endpoint.
   */
  async findOneForPlatform(id: string) {
    const society = await this.findOne(id);
    const memberships = await this.prisma.societyMembership.findMany({
      where: { societyId: id, role: 'SOCIETY_ADMIN', status: 'ACTIVE' },
      select: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      },
    });
    return { ...society, admins: memberships.map((m) => m.user) };
  }

  /**
   * Platform-wide totals for the console. Counted across every society, so
   * this is deliberately PlatformAdminGuard-only — a society admin must never
   * be able to learn how many other societies exist or how large they are.
   *
   * Deleted societies are excluded throughout (deletedAt: null) to match
   * findAll, so the headline count and the list below it agree.
   */
  async getPlatformStats() {
    // Societies are soft-deleted, and Flat/Building carry only a societyId
    // with no relation to filter through — so resolve the live ids first and
    // scope every count to them. Otherwise a deleted society's flats would
    // still be counted and the totals would not match the list below.
    const live = await this.prisma.society.findMany({
      where: { deletedAt: null },
      select: { id: true, isActive: true },
    });
    const liveIds = live.map((s) => s.id);

    const [buildings, flats, members, admins] = await Promise.all([
      this.prisma.building.count({ where: { societyId: { in: liveIds } } }),
      this.prisma.flat.count({ where: { societyId: { in: liveIds }, deletedAt: null } }),
      // distinct users, not membership rows: one person can hold memberships
      // in several societies, and in more than one role within one society,
      // and should count once either way.
      this.prisma.societyMembership
        .findMany({
          where: { status: 'ACTIVE', societyId: { in: liveIds } },
          select: { userId: true },
          distinct: ['userId'],
        })
        .then((rows) => rows.length),
      this.prisma.societyMembership
        .findMany({
          where: { status: 'ACTIVE', role: 'SOCIETY_ADMIN', societyId: { in: liveIds } },
          select: { userId: true },
          distinct: ['userId'],
        })
        .then((rows) => rows.length),
    ]);

    const societies = live.length;
    const activeSocieties = live.filter((s) => s.isActive).length;

    return {
      societies,
      activeSocieties,
      suspendedSocieties: societies - activeSocieties,
      buildings,
      flats,
      members,
      admins,
    };
  }

  /**
   * Everything the console's per-society page shows, in one call. Read-only
   * and platform-admin only: it exposes bill totals and member activity for
   * a society the caller doesn't belong to.
   *
   * Money fields are Decimal sums and travel as strings, like every other
   * money value in the API.
   */
  async getPlatformOverview(id: string) {
    const society = await this.findOneForPlatform(id);

    const activeMember = { memberships: { some: { societyId: id, status: 'ACTIVE' as const } } };
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      flatsByStatus,
      membersByRole,
      billTotals,
      overdueBills,
      pendingPayments,
      accountTotals,
      lastLogin,
      activeLast30Days,
      recentActivity,
    ] = await Promise.all([
      this.prisma.flat.groupBy({
        by: ['status'],
        where: { societyId: id, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.societyMembership.groupBy({
        by: ['role'],
        where: { societyId: id, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.maintenanceBill.aggregate({
        where: { societyId: id, isPublished: true },
        _count: { _all: true },
        _sum: { totalAmount: true, paidAmount: true, pendingAmount: true },
      }),
      this.prisma.maintenanceBill.count({
        where: { societyId: id, isPublished: true, isPaid: false, dueDate: { lt: new Date() } },
      }),
      this.prisma.paymentSubmission.count({
        where: { societyId: id, status: { in: ['PENDING', 'UNDER_REVIEW'] } },
      }),
      this.prisma.account.aggregate({
        where: { societyId: id, isActive: true },
        _count: { _all: true },
        _sum: { currentBalance: true },
      }),
      // Nulls sort first on a descending Postgres order, so exclude them or
      // "last login" would be a user who has never logged in.
      this.prisma.user.findFirst({
        where: { ...activeMember, lastLoginAt: { not: null } },
        orderBy: { lastLoginAt: 'desc' },
        select: { lastLoginAt: true },
      }),
      this.prisma.user.count({ where: { ...activeMember, lastLoginAt: { gte: thirtyDaysAgo } } }),
      this.prisma.auditLog.findMany({
        where: { societyId: id },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          id: true,
          action: true,
          entityType: true,
          createdAt: true,
          actor: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    const flatCounts = Object.fromEntries(flatsByStatus.map((r) => [r.status, r._count._all]));
    const roleCounts = Object.fromEntries(membersByRole.map((r) => [r.role, r._count._all]));

    return {
      society,
      flats: {
        total: flatsByStatus.reduce((n, r) => n + r._count._all, 0),
        byStatus: flatCounts,
      },
      members: {
        total: membersByRole.reduce((n, r) => n + r._count._all, 0),
        byRole: roleCounts,
        activeLast30Days,
        lastLoginAt: lastLogin?.lastLoginAt ?? null,
      },
      billing: {
        billsPublished: billTotals._count._all,
        totalBilled: billTotals._sum.totalAmount ?? '0',
        totalCollected: billTotals._sum.paidAmount ?? '0',
        totalPending: billTotals._sum.pendingAmount ?? '0',
        overdueBills,
        paymentsAwaitingReview: pendingPayments,
      },
      accounts: {
        count: accountTotals._count._all,
        totalBalance: accountTotals._sum.currentBalance ?? '0',
      },
      recentActivity,
    };
  }

  /**
   * Every user across every society, for the console's Users tab. Never
   * selects passwordHash — an explicit select, not an include, so a column
   * added to User later doesn't start leaking through here.
   */
  async listPlatformUsers(params: { page: number; limit: number; search?: string }) {
    const { skip, take, page, limit } = getPaginationParams({ page: params.page, limit: params.limit });
    const term = params.search?.trim().slice(0, 100);

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(term
        ? {
            OR: [
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          isActive: true,
          isPlatformAdmin: true,
          lastLoginAt: true,
          createdAt: true,
          memberships: {
            where: { status: 'ACTIVE' },
            select: {
              role: true,
              society: { select: { id: true, name: true, displayName: true } },
              flat: { select: { flatCode: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  /**
   * Suspend or reinstate a society.
   *
   * isActive has existed on Society since the beginning with nothing able to
   * change it — there was no endpoint and no UI, so a society could be created
   * but never switched off. This is the platform's only lever for a society
   * that stops paying or has to be taken offline.
   *
   * It does not delete anything: memberships, bills and history are untouched,
   * so reinstating restores the society exactly as it was.
   */
  async setActive(id: string, isActive: boolean, actorId: string) {
    const society = await this.findOne(id);

    const updated = await this.prisma.society.update({
      where: { id },
      data: { isActive },
    });

    await this.prisma.auditLog.create({
      data: {
        societyId: id,
        actorId,
        action: AuditAction.CONFIG_CHANGED,
        entityType: 'Society',
        entityId: id,
        oldValues: { isActive: society.isActive } as Prisma.InputJsonValue,
        newValues: {
          isActive,
          action: isActive ? 'SOCIETY_REINSTATED' : 'SOCIETY_SUSPENDED',
        } as Prisma.InputJsonValue,
      },
    });

    return updated;
  }

  async findOneForMember(id: string, userId: string) {
    const membership = await this.prisma.societyMembership.findFirst({
      where: { societyId: id, userId, status: 'ACTIVE' },
    });
    if (!membership) throw new ForbiddenException('Not a member of this society');
    return this.findOne(id);
  }

  async update(id: string, dto: Partial<CreateSocietyDto>) {
    await this.findOne(id);
    return this.prisma.society.update({
      where: { id },
      data: dto,
    });
  }

  async updateConfiguration(societyId: string, dto: UpdateSocietyConfigDto) {
    await this.findOne(societyId);

    // upiId and waterBillingEnabled have no DB column; fold both into the
    // existing additionalConfig JSON field rather than migrate the schema.
    const { upiId, waterBillingEnabled, ...configFields } = dto as UpdateSocietyConfigDto & {
      upiId?: string;
      waterBillingEnabled?: boolean;
    };

    let additionalConfigPatch: Prisma.InputJsonValue | undefined;
    if (upiId !== undefined || waterBillingEnabled !== undefined) {
      const current = await this.prisma.societyConfiguration.findUnique({
        where: { societyId },
        select: { additionalConfig: true },
      });
      const existing = (current?.additionalConfig as Record<string, unknown>) ?? {};
      additionalConfigPatch = {
        ...existing,
        ...(upiId !== undefined ? { upiId } : {}),
        ...(waterBillingEnabled !== undefined ? { waterBillingEnabled } : {}),
      } as Prisma.InputJsonValue;
    }

    const data: Prisma.SocietyConfigurationUpdateInput = {
      ...configFields,
      ...(additionalConfigPatch !== undefined ? { additionalConfig: additionalConfigPatch } : {}),
    };

    return this.prisma.societyConfiguration.upsert({
      where: { societyId },
      create: {
        ...configFields,
        ...(additionalConfigPatch !== undefined ? { additionalConfig: additionalConfigPatch } : {}),
        societyId,
      } as Prisma.SocietyConfigurationUncheckedCreateInput,
      update: data,
    });
  }

  async getConfiguration(societyId: string) {
    const config = await this.prisma.societyConfiguration.findUnique({
      where: { societyId },
    });
    if (!config) throw new NotFoundException('Society configuration not found');
    return config;
  }

  async getStats(societyId: string) {
    const [buildings, flats, members, activePeriod] = await Promise.all([
      this.prisma.building.count({ where: { societyId, isActive: true } }),
      this.prisma.flat.count({ where: { societyId, isActive: true } }),
      this.prisma.societyMembership.count({ where: { societyId, status: 'ACTIVE' } }),
      this.prisma.billingPeriod.findFirst({
        where: { societyId, status: { not: 'CLOSED' } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { buildings, flats, members, currentPeriod: activePeriod };
  }

  /**
   * Resident-safe financial transparency summary. These flags had existed on
   * SocietyConfiguration since it was added, but nothing anywhere in the API
   * ever read them — there was no endpoint a resident could call for this
   * data at all (accounts/reports are SOCIETY_ADMIN/ACCOUNTANT-only). This is
   * the first thing that actually enforces them, server-side, so a resident
   * can never see more than the admin has switched on regardless of what the
   * client requests.
   *
   * Note what `showAccountBalancesToResidents` covers: the total bank
   * balance, and nothing else. Which *funds* a resident sees is decided
   * per-fund by Fund.isVisibleToResidents, in FundsService.findAll. Keeping
   * those separate is deliberate — a society may want the corpus public and
   * a legal-dispute fund private — but it does mean this flag must never be
   * described to admins as controlling fund balances. It previously was, and
   * a third flag (showCorpusToResidents) claimed to control corpus while
   * being read by nothing at all; both are fixed as of this change.
   */
  async getResidentFinancialSummary(societyId: string) {
    const config = await this.prisma.societyConfiguration.findUnique({ where: { societyId } });

    const showBalances = config?.showAccountBalancesToResidents ?? false;
    const showExpenses = config?.showExpensesToResidents ?? false;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalBalance, expenses, salaryAgg] = await Promise.all([
      showBalances
        ? this.prisma.account.aggregate({
            where: { societyId, isActive: true },
            _sum: { currentBalance: true },
          })
        : null,
      // findMany (not aggregate) so we can group by category below — same
      // approach as ReportsController.expenseSummary, but this endpoint is
      // TenantGuard-only (no RolesGuard), so residents can actually call it.
      showExpenses
        ? this.prisma.expense.findMany({
            where: { societyId, status: { in: ['APPROVED', 'PAID'] }, expenseDate: { gte: monthStart } },
            include: { category: { select: { name: true } } },
          })
        : null,
      // "Watchmen salary" lives in SalaryRecord, a separate ledger from
      // Expense — folded in here so the resident's month view is genuinely
      // holistic rather than silently missing payroll.
      showExpenses
        ? this.prisma.salaryRecord.aggregate({
            where: {
              societyId,
              salaryMonth: now.getMonth() + 1,
              salaryYear: now.getFullYear(),
              status: { in: ['PROCESSED', 'PAID'] },
            },
            _sum: { netSalary: true },
          })
        : null,
    ]);

    let byCategory: { category: string; total: number }[] | null = null;
    let monthlyExpenses: number | null = null;

    if (showExpenses) {
      const byCategoryMap: Record<string, number> = {};
      let total = 0;
      for (const expense of expenses ?? []) {
        const cat = expense.category?.name ?? 'Uncategorized';
        byCategoryMap[cat] = (byCategoryMap[cat] ?? 0) + expense.amount.toNumber();
        total += expense.amount.toNumber();
      }
      const salaryTotal = salaryAgg?._sum.netSalary?.toNumber() ?? 0;
      if (salaryTotal > 0) {
        byCategoryMap['Staff Salaries'] = salaryTotal;
        total += salaryTotal;
      }
      byCategory = Object.entries(byCategoryMap)
        .map(([category, catTotal]) => ({ category, total: catTotal }))
        .sort((a, b) => b.total - a.total);
      monthlyExpenses = total;
    }

    return {
      showBalances,
      showExpenses,
      totalBalance: showBalances ? (totalBalance?._sum.currentBalance?.toNumber() ?? 0) : null,
      monthlyExpenses,
      byCategory,
    };
  }

  // ─── Join-code endpoints ────────────────────────────────────────────────────

  /**
   * Public lookup — resolves a join code to the society's name + flat list.
   * Returns only what a prospective resident needs to fill the join form.
   * No authentication required; the join code itself is the gate.
   */
  async findByJoinCode(joinCode: string) {
    const code = joinCode.toUpperCase().trim();
    const society = await this.prisma.society.findUnique({
      where: { joinCode: code },
      include: {
        buildings: {
          where: { isActive: true, deletedAt: null },
          include: {
            flats: {
              where: { isActive: true, deletedAt: null },
              select: { id: true, flatCode: true, unitNumber: true },
              orderBy: { flatCode: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!society || !society.isActive || society.deletedAt) {
      throw new NotFoundException('Society not found for this join code');
    }

    const flats = society.buildings.flatMap((b) =>
      b.flats.map((f) => ({ id: f.id, flatCode: f.flatCode })),
    );

    return {
      id: society.id,
      name: society.name,
      displayName: society.displayName,
      flats,
    };
  }

  /**
   * Admin-only — return the current join code for the admin's society.
   * Generates one on the fly if the society was created before this feature.
   */
  async getJoinCode(societyId: string): Promise<{ joinCode: string; generatedAt: Date | null }> {
    let society = await this.prisma.society.findUnique({
      where: { id: societyId },
      select: { id: true, joinCode: true, joinCodeGeneratedAt: true, isActive: true },
    });
    if (!society) throw new NotFoundException('Society not found');

    // Back-fill for societies created before this feature
    if (!society.joinCode) {
      const newCode = await generateUniqueJoinCode(this.prisma);
      society = await this.prisma.society.update({
        where: { id: societyId },
        data: { joinCode: newCode, joinCodeGeneratedAt: new Date() },
        select: { id: true, joinCode: true, joinCodeGeneratedAt: true, isActive: true },
      });
    }

    return {
      joinCode: society.joinCode!,
      generatedAt: society.joinCodeGeneratedAt,
    };
  }

  /**
   * Admin-only — rotate the join code. Invalidates the old code immediately.
   * Existing members are unaffected; only new join attempts use the new code.
   */
  async regenerateJoinCode(societyId: string): Promise<{ joinCode: string; generatedAt: Date }> {
    const society = await this.prisma.society.findUnique({ where: { id: societyId } });
    if (!society) throw new NotFoundException('Society not found');

    const newCode = await generateUniqueJoinCode(this.prisma);
    const now = new Date();

    await this.prisma.society.update({
      where: { id: societyId },
      data: { joinCode: newCode, joinCodeGeneratedAt: now },
    });

    return { joinCode: newCode, generatedAt: now };
  }
}
