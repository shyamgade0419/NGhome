/**
 * Development-only seed script for NG Home API.
 * Creates a platform admin, a demo society, buildings, flats, residents,
 * billing configuration, sample expenses, funds, and accounts.
 *
 * WARNING: Never run this in production without clearing demo credentials first.
 */

import { PrismaClient, SystemRole, FlatStatus, AccountType, WaterBillingModel, CalculationType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO = {
  platformAdmin: {
    email: 'admin@novagade.in',
    password: 'Admin@Demo123!',
    firstName: 'Platform',
    lastName: 'Admin',
  },
  societyAdmin: {
    email: 'societyadmin@nghomedemo.in',
    password: 'SocAdmin@123!',
    firstName: 'Ramesh',
    lastName: 'Kumar',
  },
  resident1: {
    email: 'resident1@nghomedemo.in',
    password: 'Resident@123!',
    firstName: 'Ananya',
    lastName: 'Sharma',
  },
  resident2: {
    email: 'resident2@nghomedemo.in',
    password: 'Resident@123!',
    firstName: 'Vikram',
    lastName: 'Patel',
  },
  accountant: {
    email: 'accountant@nghomedemo.in',
    password: 'Accountant@123!',
    firstName: 'Priya',
    lastName: 'Mehta',
  },
};

async function main() {
  console.log('🌱 Seeding NG Home demo data...\n');

  // ── Platform Admin ─────────────────────────────────────────────────────────
  const platformAdmin = await prisma.user.upsert({
    where: { email: DEMO.platformAdmin.email },
    update: {},
    create: {
      email: DEMO.platformAdmin.email,
      passwordHash: await argon2.hash(DEMO.platformAdmin.password),
      firstName: DEMO.platformAdmin.firstName,
      lastName: DEMO.platformAdmin.lastName,
      isPlatformAdmin: true,
      isActive: true,
      emailVerified: true,
    },
  });
  console.log(`✅ Platform Admin: ${platformAdmin.email}`);

  // ── Demo Society ───────────────────────────────────────────────────────────
  let society = await prisma.society.findFirst({ where: { name: 'NG Home Demo Society' } });

  if (!society) {
    society = await prisma.society.create({
      data: {
        name: 'NG Home Demo Society',
        displayName: 'NG Home Demo',
        address: '123 Demo Road, Hitech City',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
        email: 'contact@nghomedemo.in',
        phone: '+91 9876543210',
        isActive: true,
        configuration: {
          create: {
            currency: 'INR',
            financialYearStartMonth: 4,
            billingCycle: 'MONTHLY',
            billingDueDay: 10,
            gracePeriodDays: 5,
            lateFeeType: 'FIXED',
            lateFeeValue: 500,
            invoicePrefix: 'NGDEMO',
            invoiceStartNumber: 1001,
            invoiceCurrentNumber: 1001,
            paymentVerificationRequired: true,
            allowPaymentProofUpload: true,
            showCorpusToResidents: true,
            showFundBalancesToResidents: true,
            publishStatementToResidents: true,
            publishMeetingMinutes: true,
          },
        },
      },
    });
    console.log(`✅ Society created: ${society.name}`);
  } else {
    console.log(`ℹ️  Society already exists: ${society.name}`);
  }

  // ── Society Admin User ─────────────────────────────────────────────────────
  const societyAdminUser = await prisma.user.upsert({
    where: { email: DEMO.societyAdmin.email },
    update: {},
    create: {
      email: DEMO.societyAdmin.email,
      passwordHash: await argon2.hash(DEMO.societyAdmin.password),
      firstName: DEMO.societyAdmin.firstName,
      lastName: DEMO.societyAdmin.lastName,
      isActive: true,
      emailVerified: true,
    },
  });

  await prisma.societyMembership.upsert({
    where: { societyId_userId_flatId: { societyId: society.id, userId: societyAdminUser.id, flatId: '' } },
    update: {},
    create: {
      societyId: society.id,
      userId: societyAdminUser.id,
      role: SystemRole.SOCIETY_ADMIN,
      status: 'ACTIVE',
      isPrimary: false,
    },
  });
  console.log(`✅ Society Admin: ${societyAdminUser.email}`);

  // ── Accountant ─────────────────────────────────────────────────────────────
  const accountantUser = await prisma.user.upsert({
    where: { email: DEMO.accountant.email },
    update: {},
    create: {
      email: DEMO.accountant.email,
      passwordHash: await argon2.hash(DEMO.accountant.password),
      firstName: DEMO.accountant.firstName,
      lastName: DEMO.accountant.lastName,
      isActive: true,
      emailVerified: true,
    },
  });

  await prisma.societyMembership.upsert({
    where: { societyId_userId_flatId: { societyId: society.id, userId: accountantUser.id, flatId: '' } },
    update: {},
    create: {
      societyId: society.id,
      userId: accountantUser.id,
      role: SystemRole.SOCIETY_ACCOUNTANT,
      status: 'ACTIVE',
      isPrimary: false,
    },
  });
  console.log(`✅ Accountant: ${accountantUser.email}`);

  // ── Building & Flats ───────────────────────────────────────────────────────
  let building = await prisma.building.findFirst({ where: { societyId: society.id, name: 'Block A' } });

  if (!building) {
    building = await prisma.building.create({
      data: {
        societyId: society.id,
        name: 'Block A',
        code: 'A',
        description: 'Main residential block',
        totalFloors: 5,
      },
    });
  }
  console.log(`✅ Building: ${building.name}`);

  // Create flats
  const flatDefs = [
    { unit: '101', code: 'A-101', area: 850, bedrooms: 2, category: '2BHK' },
    { unit: '102', code: 'A-102', area: 1100, bedrooms: 3, category: '3BHK' },
    { unit: '201', code: 'A-201', area: 850, bedrooms: 2, category: '2BHK' },
    { unit: '202', code: 'A-202', area: 650, bedrooms: 1, category: '1BHK' },
    { unit: '301', code: 'A-301', area: 850, bedrooms: 2, category: '2BHK' },
  ];

  const flats: Awaited<ReturnType<typeof prisma.flat.upsert>>[] = [];
  for (const f of flatDefs) {
    const flat = await prisma.flat.upsert({
      where: { societyId_flatCode: { societyId: society.id, flatCode: f.code } },
      update: {},
      create: {
        societyId: society.id,
        buildingId: building.id,
        unitNumber: f.unit,
        flatCode: f.code,
        area: f.area,
        bedrooms: f.bedrooms,
        category: f.category,
        status: FlatStatus.ACTIVE,
        isActive: true,
      },
    });
    flats.push(flat);
  }
  console.log(`✅ ${flats.length} flats created`);

  // ── Residents ──────────────────────────────────────────────────────────────
  const resident1 = await prisma.user.upsert({
    where: { email: DEMO.resident1.email },
    update: {},
    create: {
      email: DEMO.resident1.email,
      passwordHash: await argon2.hash(DEMO.resident1.password),
      firstName: DEMO.resident1.firstName,
      lastName: DEMO.resident1.lastName,
      isActive: true,
      emailVerified: true,
    },
  });

  await prisma.societyMembership.upsert({
    where: { societyId_userId_flatId: { societyId: society.id, userId: resident1.id, flatId: flats[0].id } },
    update: {},
    create: {
      societyId: society.id,
      userId: resident1.id,
      flatId: flats[0].id,
      role: SystemRole.RESIDENT,
      status: 'ACTIVE',
      isPrimary: true,
    },
  });
  console.log(`✅ Resident: ${resident1.email} → ${flats[0].flatCode}`);

  const resident2 = await prisma.user.upsert({
    where: { email: DEMO.resident2.email },
    update: {},
    create: {
      email: DEMO.resident2.email,
      passwordHash: await argon2.hash(DEMO.resident2.password),
      firstName: DEMO.resident2.firstName,
      lastName: DEMO.resident2.lastName,
      isActive: true,
      emailVerified: true,
    },
  });

  await prisma.societyMembership.upsert({
    where: { societyId_userId_flatId: { societyId: society.id, userId: resident2.id, flatId: flats[1].id } },
    update: {},
    create: {
      societyId: society.id,
      userId: resident2.id,
      flatId: flats[1].id,
      role: SystemRole.RESIDENT,
      status: 'ACTIVE',
      isPrimary: true,
    },
  });
  console.log(`✅ Resident: ${resident2.email} → ${flats[1].flatCode}`);

  // ── Billing Rule ───────────────────────────────────────────────────────────
  const billingRule = await prisma.billingRule.upsert({
    where: { id: 'seed-billing-rule-001' },
    update: {},
    create: {
      id: 'seed-billing-rule-001',
      societyId: society.id,
      name: 'Area-based Maintenance',
      description: 'Maintenance calculated at ₹5 per sq ft per month',
      calculationType: CalculationType.AREA_BASED,
      isActive: true,
      effectiveFrom: new Date('2025-01-01'),
      priority: 1,
      config: { ratePerSqft: 5 },
    },
  });
  console.log(`✅ Billing rule: ${billingRule.name}`);

  // ── Bank Account ───────────────────────────────────────────────────────────
  const account = await prisma.account.upsert({
    where: { id: 'seed-account-001' },
    update: {},
    create: {
      id: 'seed-account-001',
      societyId: society.id,
      name: 'Main Maintenance Account',
      accountType: AccountType.SAVINGS,
      bankName: 'State Bank of India',
      accountNumberMasked: '****4321',
      openingBalance: 50000,
      currentBalance: 50000,
      description: 'Primary collection account',
    },
  });
  console.log(`✅ Account: ${account.name}`);

  // ── Corpus Fund ────────────────────────────────────────────────────────────
  const fund = await prisma.fund.upsert({
    where: { id: 'seed-fund-001' },
    update: {},
    create: {
      id: 'seed-fund-001',
      societyId: society.id,
      name: 'Corpus Fund',
      description: 'Long-term capital reserve fund',
      openingBalance: 200000,
      currentBalance: 200000,
      isVisibleToResidents: true,
      accountId: account.id,
    },
  });
  console.log(`✅ Fund: ${fund.name}`);

  // ── Expense Category ───────────────────────────────────────────────────────
  const expenseCategories = ['Security', 'Housekeeping', 'Maintenance', 'Water', 'Electricity (Common)', 'Gardening', 'Other'];
  for (const cat of expenseCategories) {
    await prisma.expenseCategory.upsert({
      where: { societyId_name: { societyId: society.id, name: cat } },
      update: {},
      create: { societyId: society.id, name: cat },
    });
  }
  console.log(`✅ ${expenseCategories.length} expense categories`);

  // ── Sample Expense ─────────────────────────────────────────────────────────
  const securityCategory = await prisma.expenseCategory.findFirst({
    where: { societyId: society.id, name: 'Security' },
  });

  const existingExpense = await prisma.expense.findFirst({
    where: { societyId: society.id, description: 'Security guard services for December 2024' },
  });
  if (!existingExpense) {
    await prisma.expense.create({
      data: {
        societyId: society.id,
        categoryId: securityCategory?.id,
        accountId: account.id,
        vendorPayee: 'SecureGuard Services',
        description: 'Security guard services for December 2024',
        amount: 15000,
        expenseDate: new Date('2025-01-05'),
        status: 'APPROVED',
        approvedAt: new Date('2025-01-06'),
        createdById: societyAdminUser.id,
        approvedById: societyAdminUser.id,
      },
    });
    console.log(`✅ Sample expense created`);
  } else {
    console.log(`ℹ️  Sample expense already exists`);
  }

  // ── Water Billing Config ───────────────────────────────────────────────────
  await prisma.waterBillingConfig.upsert({
    where: { id: 'seed-water-config-001' },
    update: {},
    create: {
      id: 'seed-water-config-001',
      societyId: society.id,
      name: 'Standard Water Billing',
      billingModel: WaterBillingModel.PER_KL,
      isActive: true,
      effectiveFrom: new Date('2025-01-01'),
      config: { ratePerKL: 50 },
    },
  });
  console.log(`✅ Water billing config`);

  // ── Announcement ───────────────────────────────────────────────────────────
  const existingAnnouncement = await prisma.announcement.findFirst({
    where: { societyId: society.id, title: 'Welcome to NG Home Demo' },
  });
  if (!existingAnnouncement) {
    await prisma.announcement.create({
      data: {
        societyId: society.id,
        createdById: societyAdminUser.id,
        title: 'Welcome to NG Home Demo',
        content: 'Welcome to the NG Home Demo Society. This is a sample announcement.',
        priority: 'NORMAL',
        audience: 'ALL_RESIDENTS',
        isPublished: true,
        publishedAt: new Date(),
      },
    });
    console.log(`✅ Sample announcement created`);
  } else {
    console.log(`ℹ️  Sample announcement already exists`);
  }

  // ── Employee ───────────────────────────────────────────────────────────────
  const existingEmployee = await prisma.societyEmployee.findFirst({
    where: { societyId: society.id, employeeCode: 'EMP001' },
  });
  if (!existingEmployee) {
    await prisma.societyEmployee.create({
      data: {
        societyId: society.id,
        name: 'Raju Prasad',
        designation: 'Security Guard',
        employeeCode: 'EMP001',
        baseSalary: 12000,
        isActive: true,
      },
    });
    console.log(`✅ Sample employee created`);
  } else {
    console.log(`ℹ️  Sample employee already exists`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🎉 Seed complete! Demo credentials (DEV ONLY):');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Platform Admin : ${DEMO.platformAdmin.email} / ${DEMO.platformAdmin.password}`);
  console.log(`Society Admin  : ${DEMO.societyAdmin.email} / ${DEMO.societyAdmin.password}`);
  console.log(`Accountant     : ${DEMO.accountant.email} / ${DEMO.accountant.password}`);
  console.log(`Resident 1     : ${DEMO.resident1.email} / ${DEMO.resident1.password}`);
  console.log(`Resident 2     : ${DEMO.resident2.email} / ${DEMO.resident2.password}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
