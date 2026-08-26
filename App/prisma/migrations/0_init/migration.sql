-- NG Home — baseline schema
-- Applied to a fresh database before any incremental migrations.
-- Does NOT include fields added by later migrations:
--   • societies.registrationNumber  (→ 20260825_add_society_registration_number)
--   • refresh_tokens context fields (→ 20260825_refresh_token_context_fields)

-- ─── ENUMS ───────────────────────────────────────────────────────────────────

CREATE TYPE "SystemRole" AS ENUM (
  'PLATFORM_ADMIN','SOCIETY_ADMIN','SOCIETY_ACCOUNTANT',
  'SOCIETY_STAFF','RESIDENT','COMMITTEE_MEMBER'
);
CREATE TYPE "BillingCycleType" AS ENUM ('MONTHLY','QUARTERLY','ANNUAL','CUSTOM');
CREATE TYPE "CalculationType" AS ENUM (
  'EQUAL_PER_FLAT','AREA_BASED','PER_PERSON','HYBRID',
  'FIXED_CUSTOM','PERCENTAGE_BASED','WATER_USAGE_BASED','CUSTOM_FORMULA'
);
CREATE TYPE "BillingPeriodStatus" AS ENUM (
  'DRAFT','CALCULATED','REVIEW','PUBLISHED','PARTIALLY_PAID','PAID','CLOSED'
);
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING','UNDER_REVIEW','APPROVED','REJECTED','CANCELLED');
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER','UPI','CASH','CHEQUE','NEFT','RTGS','IMPS','OTHER');
CREATE TYPE "AccountType" AS ENUM ('SAVINGS','CURRENT','FIXED_DEPOSIT','CASH','OTHER');
CREATE TYPE "TransactionType" AS ENUM ('CREDIT','DEBIT');
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING','APPROVED','REJECTED','PAID');
CREATE TYPE "SalaryStatus" AS ENUM ('DRAFT','PROCESSED','PAID','CANCELLED');
CREATE TYPE "AnnouncementPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
CREATE TYPE "AnnouncementAudience" AS ENUM (
  'ALL_RESIDENTS','BUILDING','BLOCK','SPECIFIC_FLATS','COMMITTEE','STAFF','ALL'
);
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH','EMAIL','SMS','IN_APP');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING','SENT','FAILED','READ');
CREATE TYPE "DocumentAccessLevel" AS ENUM ('PUBLIC','RESIDENTS_ONLY','ADMIN_ONLY','COMMITTEE_ONLY');
CREATE TYPE "WaterBillingModel" AS ENUM (
  'PER_LITRE','PER_KL','FIXED_CHARGE','SLAB_BASED','FIXED_PLUS_USAGE','SOCIETY_ALLOCATION','CUSTOM'
);
CREATE TYPE "FlatStatus" AS ENUM ('ACTIVE','VACANT','UNDER_RENOVATION','INACTIVE');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE','INACTIVE','PENDING','SUSPENDED');
CREATE TYPE "AuditAction" AS ENUM (
  'LOGIN','LOGOUT','USER_CREATED','USER_MODIFIED','USER_DEACTIVATED','USER_DELETED',
  'BILL_GENERATED','BILL_MODIFIED','BILL_PUBLISHED',
  'PAYMENT_SUBMITTED','PAYMENT_APPROVED','PAYMENT_REJECTED',
  'EXPENSE_CREATED','EXPENSE_MODIFIED','EXPENSE_APPROVED',
  'ACCOUNT_TRANSACTION','FUND_TRANSACTION','CONFIG_CHANGED','PERIOD_CLOSED','OTHER'
);

-- ─── USERS ───────────────────────────────────────────────────────────────────

CREATE TABLE "users" (
  "id"              TEXT        NOT NULL,
  "email"           TEXT        NOT NULL,
  "phone"           TEXT,
  "passwordHash"    TEXT        NOT NULL,
  "firstName"       TEXT        NOT NULL,
  "lastName"        TEXT        NOT NULL,
  "isActive"        BOOLEAN     NOT NULL DEFAULT true,
  "isPlatformAdmin" BOOLEAN     NOT NULL DEFAULT false,
  "emailVerified"   BOOLEAN     NOT NULL DEFAULT false,
  "phoneVerified"   BOOLEAN     NOT NULL DEFAULT false,
  "lastLoginAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "deletedAt"       TIMESTAMP(3),
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- ─── REFRESH TOKENS ──────────────────────────────────────────────────────────
-- NOTE: societyId/membershipId/role/flatId added by 20260825_refresh_token_context_fields

CREATE TABLE "refresh_tokens" (
  "id"        TEXT        NOT NULL,
  "userId"    TEXT        NOT NULL,
  "tokenHash" TEXT        NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "isRevoked" BOOLEAN     NOT NULL DEFAULT false,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_userId_idx"    ON "refresh_tokens"("userId");
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "refresh_tokens"("tokenHash");
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── SOCIETIES ───────────────────────────────────────────────────────────────
-- NOTE: registrationNumber added by 20260825_add_society_registration_number

CREATE TABLE "societies" (
  "id"          TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "displayName" TEXT,
  "address"     TEXT,
  "city"        TEXT,
  "state"       TEXT,
  "pincode"     TEXT,
  "country"     TEXT        NOT NULL DEFAULT 'India',
  "email"       TEXT,
  "phone"       TEXT,
  "website"     TEXT,
  "logoUrl"     TEXT,
  "isActive"    BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),
  CONSTRAINT "societies_pkey" PRIMARY KEY ("id")
);

-- ─── SOCIETY CONFIGURATION ───────────────────────────────────────────────────

CREATE TABLE "society_configurations" (
  "id"                          TEXT             NOT NULL,
  "societyId"                   TEXT             NOT NULL,
  "currency"                    TEXT             NOT NULL DEFAULT 'INR',
  "financialYearStartMonth"     INTEGER          NOT NULL DEFAULT 4,
  "billingCycle"                "BillingCycleType" NOT NULL DEFAULT 'MONTHLY',
  "billingDueDay"               INTEGER          NOT NULL DEFAULT 10,
  "gracePeriodDays"             INTEGER          NOT NULL DEFAULT 5,
  "lateFeeType"                 TEXT,
  "lateFeeValue"                DECIMAL(10,2),
  "lateFeeMaxAmount"            DECIMAL(10,2),
  "roundingRule"                TEXT             NOT NULL DEFAULT 'NEAREST',
  "invoicePrefix"               TEXT             NOT NULL DEFAULT 'INV',
  "invoiceStartNumber"          INTEGER          NOT NULL DEFAULT 1,
  "invoiceCurrentNumber"        INTEGER          NOT NULL DEFAULT 1,
  "paymentVerificationRequired" BOOLEAN          NOT NULL DEFAULT true,
  "allowPaymentProofUpload"     BOOLEAN          NOT NULL DEFAULT true,
  "showCorpusToResidents"       BOOLEAN          NOT NULL DEFAULT false,
  "showFundBalancesToResidents" BOOLEAN          NOT NULL DEFAULT false,
  "showExpensesToResidents"     BOOLEAN          NOT NULL DEFAULT false,
  "publishStatementToResidents" BOOLEAN          NOT NULL DEFAULT true,
  "publishMeetingMinutes"       BOOLEAN          NOT NULL DEFAULT true,
  "notificationChannels"        JSONB            NOT NULL DEFAULT '[]',
  "additionalConfig"            JSONB            NOT NULL DEFAULT '{}',
  "createdAt"                   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                   TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "society_configurations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "society_configurations_societyId_key" ON "society_configurations"("societyId");
ALTER TABLE "society_configurations"
  ADD CONSTRAINT "society_configurations_societyId_fkey"
  FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── BUILDINGS ───────────────────────────────────────────────────────────────

CREATE TABLE "buildings" (
  "id"          TEXT        NOT NULL,
  "societyId"   TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "code"        TEXT,
  "description" TEXT,
  "totalFloors" INTEGER,
  "isActive"    BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),
  CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "buildings_societyId_code_key" ON "buildings"("societyId","code");
CREATE INDEX "buildings_societyId_idx" ON "buildings"("societyId");
ALTER TABLE "buildings"
  ADD CONSTRAINT "buildings_societyId_fkey"
  FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── FLOORS ──────────────────────────────────────────────────────────────────

CREATE TABLE "floors" (
  "id"         TEXT        NOT NULL,
  "buildingId" TEXT        NOT NULL,
  "number"     INTEGER     NOT NULL,
  "name"       TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "floors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "floors_buildingId_number_key" ON "floors"("buildingId","number");
CREATE INDEX "floors_buildingId_idx" ON "floors"("buildingId");
ALTER TABLE "floors"
  ADD CONSTRAINT "floors_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── FLATS ───────────────────────────────────────────────────────────────────

CREATE TABLE "flats" (
  "id"             TEXT        NOT NULL,
  "societyId"      TEXT        NOT NULL,
  "buildingId"     TEXT        NOT NULL,
  "floorId"        TEXT,
  "unitNumber"     TEXT        NOT NULL,
  "flatCode"       TEXT        NOT NULL,
  "area"           DECIMAL(10,2),
  "bedrooms"       INTEGER,
  "bathrooms"      INTEGER,
  "category"       TEXT,
  "status"         "FlatStatus" NOT NULL DEFAULT 'ACTIVE',
  "ownershipType"  TEXT,
  "parkingSlots"   INTEGER     NOT NULL DEFAULT 0,
  "additionalInfo" JSONB       NOT NULL DEFAULT '{}',
  "isActive"       BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "flats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "flats_societyId_flatCode_key" ON "flats"("societyId","flatCode");
CREATE INDEX "flats_societyId_idx"  ON "flats"("societyId");
CREATE INDEX "flats_buildingId_idx" ON "flats"("buildingId");
ALTER TABLE "flats"
  ADD CONSTRAINT "flats_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "flats_floorId_fkey"   FOREIGN KEY ("floorId")    REFERENCES "floors"("id")    ON UPDATE CASCADE;

-- ─── SOCIETY MEMBERSHIPS ─────────────────────────────────────────────────────

CREATE TABLE "society_memberships" (
  "id"                   TEXT              NOT NULL,
  "societyId"            TEXT              NOT NULL,
  "userId"               TEXT              NOT NULL,
  "flatId"               TEXT,
  "role"                 "SystemRole"      NOT NULL DEFAULT 'RESIDENT',
  "status"               "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "joinedAt"             TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt"               TIMESTAMP(3),
  "isPrimary"            BOOLEAN           NOT NULL DEFAULT false,
  "additionalPermissions" JSONB            NOT NULL DEFAULT '[]',
  "createdAt"            TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "society_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "society_memberships_societyId_userId_flatId_key"
  ON "society_memberships"("societyId","userId","flatId");
CREATE INDEX "society_memberships_societyId_idx" ON "society_memberships"("societyId");
CREATE INDEX "society_memberships_userId_idx"    ON "society_memberships"("userId");
ALTER TABLE "society_memberships"
  ADD CONSTRAINT "society_memberships_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "society_memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "society_memberships_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON UPDATE CASCADE;

-- ─── BILLING RULES ───────────────────────────────────────────────────────────

CREATE TABLE "billing_rules" (
  "id"              TEXT              NOT NULL,
  "societyId"       TEXT              NOT NULL,
  "name"            TEXT              NOT NULL,
  "description"     TEXT,
  "calculationType" "CalculationType" NOT NULL,
  "isActive"        BOOLEAN           NOT NULL DEFAULT true,
  "effectiveFrom"   TIMESTAMP(3)      NOT NULL,
  "effectiveTo"     TIMESTAMP(3),
  "priority"        INTEGER           NOT NULL DEFAULT 0,
  "config"          JSONB             NOT NULL DEFAULT '{}',
  "applicableTo"    JSONB             NOT NULL DEFAULT '{}',
  "createdAt"       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "billing_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "billing_rules_societyId_idx" ON "billing_rules"("societyId");
ALTER TABLE "billing_rules"
  ADD CONSTRAINT "billing_rules_societyId_fkey"
  FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── BILLING RULE COMPONENTS ─────────────────────────────────────────────────

CREATE TABLE "billing_rule_components" (
  "id"              TEXT              NOT NULL,
  "billingRuleId"   TEXT              NOT NULL,
  "name"            TEXT              NOT NULL,
  "description"     TEXT,
  "componentType"   TEXT              NOT NULL,
  "calculationType" "CalculationType" NOT NULL,
  "amount"          DECIMAL(10,2),
  "rate"            DECIMAL(10,4),
  "config"          JSONB             NOT NULL DEFAULT '{}',
  "isActive"        BOOLEAN           NOT NULL DEFAULT true,
  "order"           INTEGER           NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "billing_rule_components_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "billing_rule_components_billingRuleId_idx" ON "billing_rule_components"("billingRuleId");
ALTER TABLE "billing_rule_components"
  ADD CONSTRAINT "billing_rule_components_billingRuleId_fkey"
  FOREIGN KEY ("billingRuleId") REFERENCES "billing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── BILLING PERIODS ─────────────────────────────────────────────────────────

CREATE TABLE "billing_periods" (
  "id"             TEXT                  NOT NULL,
  "societyId"      TEXT                  NOT NULL,
  "periodYear"     INTEGER               NOT NULL,
  "periodMonth"    INTEGER               NOT NULL,
  "startDate"      TIMESTAMP(3)          NOT NULL,
  "endDate"        TIMESTAMP(3)          NOT NULL,
  "dueDate"        TIMESTAMP(3)          NOT NULL,
  "status"         "BillingPeriodStatus" NOT NULL DEFAULT 'DRAFT',
  "totalBilled"    DECIMAL(15,2)         NOT NULL DEFAULT 0,
  "totalCollected" DECIMAL(15,2)         NOT NULL DEFAULT 0,
  "totalPending"   DECIMAL(15,2)         NOT NULL DEFAULT 0,
  "notes"          TEXT,
  "publishedAt"    TIMESTAMP(3),
  "publishedById"  TEXT,
  "closedAt"       TIMESTAMP(3),
  "closedById"     TEXT,
  "createdAt"      TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)          NOT NULL,
  CONSTRAINT "billing_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_periods_societyId_periodYear_periodMonth_key"
  ON "billing_periods"("societyId","periodYear","periodMonth");
CREATE INDEX "billing_periods_societyId_idx" ON "billing_periods"("societyId");
ALTER TABLE "billing_periods"
  ADD CONSTRAINT "billing_periods_societyId_fkey"
  FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── MAINTENANCE BILLS ───────────────────────────────────────────────────────

CREATE TABLE "maintenance_bills" (
  "id"                  TEXT         NOT NULL,
  "societyId"           TEXT         NOT NULL,
  "billingPeriodId"     TEXT         NOT NULL,
  "flatId"              TEXT         NOT NULL,
  "invoiceNumber"       TEXT         NOT NULL,
  "flatCode"            TEXT         NOT NULL,
  "flatArea"            DECIMAL(10,2),
  "flatCategory"        TEXT,
  "residentCount"       INTEGER      NOT NULL DEFAULT 0,
  "baseAmount"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  "adjustments"         DECIMAL(12,2) NOT NULL DEFAULT 0,
  "waterCharges"        DECIMAL(12,2) NOT NULL DEFAULT 0,
  "lateFee"             DECIMAL(12,2) NOT NULL DEFAULT 0,
  "otherCharges"        DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalAmount"         DECIMAL(12,2) NOT NULL DEFAULT 0,
  "paidAmount"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  "pendingAmount"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  "calculationSnapshot" JSONB        NOT NULL DEFAULT '{}',
  "notes"               TEXT,
  "dueDate"             TIMESTAMP(3) NOT NULL,
  "isPaid"              BOOLEAN      NOT NULL DEFAULT false,
  "isPublished"         BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "maintenance_bills_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "maintenance_bills_societyId_billingPeriodId_flatId_key"
  ON "maintenance_bills"("societyId","billingPeriodId","flatId");
CREATE UNIQUE INDEX "maintenance_bills_societyId_invoiceNumber_key"
  ON "maintenance_bills"("societyId","invoiceNumber");
CREATE INDEX "maintenance_bills_societyId_idx"       ON "maintenance_bills"("societyId");
CREATE INDEX "maintenance_bills_billingPeriodId_idx" ON "maintenance_bills"("billingPeriodId");
CREATE INDEX "maintenance_bills_flatId_idx"          ON "maintenance_bills"("flatId");
ALTER TABLE "maintenance_bills"
  ADD CONSTRAINT "maintenance_bills_billingPeriodId_fkey"
    FOREIGN KEY ("billingPeriodId") REFERENCES "billing_periods"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_bills_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON UPDATE CASCADE;

-- ─── BILL LINE ITEMS ─────────────────────────────────────────────────────────

CREATE TABLE "bill_line_items" (
  "id"                TEXT         NOT NULL,
  "maintenanceBillId" TEXT         NOT NULL,
  "billingRuleId"     TEXT,
  "componentName"     TEXT         NOT NULL,
  "componentType"     TEXT         NOT NULL,
  "description"       TEXT,
  "quantity"          DECIMAL(10,4),
  "rate"              DECIMAL(10,4),
  "amount"            DECIMAL(12,2) NOT NULL,
  "calculationNote"   TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bill_line_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bill_line_items_maintenanceBillId_idx" ON "bill_line_items"("maintenanceBillId");
ALTER TABLE "bill_line_items"
  ADD CONSTRAINT "bill_line_items_maintenanceBillId_fkey"
    FOREIGN KEY ("maintenanceBillId") REFERENCES "maintenance_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "bill_line_items_billingRuleId_fkey"
    FOREIGN KEY ("billingRuleId") REFERENCES "billing_rules"("id") ON UPDATE CASCADE;

-- ─── WATER BILLING ───────────────────────────────────────────────────────────

CREATE TABLE "water_billing_configs" (
  "id"            TEXT               NOT NULL,
  "societyId"     TEXT               NOT NULL,
  "name"          TEXT               NOT NULL,
  "billingModel"  "WaterBillingModel" NOT NULL,
  "isActive"      BOOLEAN            NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3)       NOT NULL,
  "effectiveTo"   TIMESTAMP(3),
  "config"        JSONB              NOT NULL DEFAULT '{}',
  "createdAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)       NOT NULL,
  CONSTRAINT "water_billing_configs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "water_billing_configs_societyId_idx" ON "water_billing_configs"("societyId");
ALTER TABLE "water_billing_configs"
  ADD CONSTRAINT "water_billing_configs_societyId_fkey"
  FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "water_meter_readings" (
  "id"               TEXT         NOT NULL,
  "societyId"        TEXT         NOT NULL,
  "flatId"           TEXT         NOT NULL,
  "waterConfigId"    TEXT,
  "billingPeriodId"  TEXT,
  "readingDate"      TIMESTAMP(3) NOT NULL,
  "openingReading"   DECIMAL(12,3) NOT NULL,
  "closingReading"   DECIMAL(12,3) NOT NULL,
  "consumption"      DECIMAL(12,3) NOT NULL,
  "unit"             TEXT         NOT NULL DEFAULT 'KL',
  "effectiveRate"    DECIMAL(10,4),
  "calculatedAmount" DECIMAL(12,2),
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "water_meter_readings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "water_meter_readings_societyId_idx" ON "water_meter_readings"("societyId");
CREATE INDEX "water_meter_readings_flatId_idx"    ON "water_meter_readings"("flatId");
ALTER TABLE "water_meter_readings"
  ADD CONSTRAINT "water_meter_readings_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "water_meter_readings_waterConfigId_fkey"
    FOREIGN KEY ("waterConfigId") REFERENCES "water_billing_configs"("id") ON UPDATE CASCADE;

-- ─── ACCOUNTS & FUNDS ────────────────────────────────────────────────────────

CREATE TABLE "accounts" (
  "id"                  TEXT          NOT NULL,
  "societyId"           TEXT          NOT NULL,
  "name"                TEXT          NOT NULL,
  "accountType"         "AccountType" NOT NULL,
  "bankName"            TEXT,
  "accountNumberMasked" TEXT,
  "ifscCode"            TEXT,
  "openingBalance"      DECIMAL(15,2) NOT NULL DEFAULT 0,
  "currentBalance"      DECIMAL(15,2) NOT NULL DEFAULT 0,
  "isActive"            BOOLEAN       NOT NULL DEFAULT true,
  "description"         TEXT,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "accounts_societyId_idx" ON "accounts"("societyId");
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_societyId_fkey"
  FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "funds" (
  "id"                   TEXT         NOT NULL,
  "societyId"            TEXT         NOT NULL,
  "name"                 TEXT         NOT NULL,
  "description"          TEXT,
  "accountId"            TEXT,
  "openingBalance"       DECIMAL(15,2) NOT NULL DEFAULT 0,
  "currentBalance"       DECIMAL(15,2) NOT NULL DEFAULT 0,
  "isVisibleToResidents" BOOLEAN      NOT NULL DEFAULT false,
  "isActive"             BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "funds_societyId_idx" ON "funds"("societyId");
ALTER TABLE "funds"
  ADD CONSTRAINT "funds_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "funds_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON UPDATE CASCADE;

CREATE TABLE "transactions" (
  "id"               TEXT              NOT NULL,
  "societyId"        TEXT              NOT NULL,
  "accountId"        TEXT,
  "fundId"           TEXT,
  "transactionType"  "TransactionType" NOT NULL,
  "amount"           DECIMAL(15,2)     NOT NULL,
  "transactionDate"  TIMESTAMP(3)      NOT NULL,
  "reference"        TEXT,
  "description"      TEXT              NOT NULL,
  "linkedEntityType" TEXT,
  "linkedEntityId"   TEXT,
  "balanceAfter"     DECIMAL(15,2)     NOT NULL,
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transactions_societyId_idx"       ON "transactions"("societyId");
CREATE INDEX "transactions_accountId_idx"       ON "transactions"("accountId");
CREATE INDEX "transactions_fundId_idx"          ON "transactions"("fundId");
CREATE INDEX "transactions_transactionDate_idx" ON "transactions"("transactionDate");
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "transactions_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "transactions_fundId_fkey"
    FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON UPDATE CASCADE;

-- ─── EXPENSES ────────────────────────────────────────────────────────────────

CREATE TABLE "expense_categories" (
  "id"          TEXT         NOT NULL,
  "societyId"   TEXT         NOT NULL,
  "name"        TEXT         NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expense_categories_societyId_name_key" ON "expense_categories"("societyId","name");
CREATE INDEX "expense_categories_societyId_idx" ON "expense_categories"("societyId");
ALTER TABLE "expense_categories"
  ADD CONSTRAINT "expense_categories_societyId_fkey"
  FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "expenses" (
  "id"              TEXT            NOT NULL,
  "societyId"       TEXT            NOT NULL,
  "categoryId"      TEXT,
  "accountId"       TEXT,
  "vendorPayee"     TEXT,
  "description"     TEXT            NOT NULL,
  "amount"          DECIMAL(12,2)   NOT NULL,
  "expenseDate"     TIMESTAMP(3)    NOT NULL,
  "invoiceNumber"   TEXT,
  "referenceNumber" TEXT,
  "status"          "ExpenseStatus" NOT NULL DEFAULT 'PENDING',
  "isRecurring"     BOOLEAN         NOT NULL DEFAULT false,
  "recurringConfig" JSONB,
  "notes"           TEXT,
  "approvedAt"      TIMESTAMP(3),
  "paidAt"          TIMESTAMP(3),
  "createdById"     TEXT            NOT NULL,
  "approvedById"    TEXT,
  "createdAt"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "expenses_societyId_idx"  ON "expenses"("societyId");
CREATE INDEX "expenses_expenseDate_idx" ON "expenses"("expenseDate");
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "expenses_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "expenses_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "expenses_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "expenses_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON UPDATE CASCADE;

-- ─── SALARIES ────────────────────────────────────────────────────────────────

CREATE TABLE "society_employees" (
  "id"             TEXT         NOT NULL,
  "societyId"      TEXT         NOT NULL,
  "name"           TEXT         NOT NULL,
  "designation"    TEXT         NOT NULL,
  "employeeCode"   TEXT,
  "phone"          TEXT,
  "email"          TEXT,
  "joinDate"       TIMESTAMP(3),
  "exitDate"       TIMESTAMP(3),
  "baseSalary"     DECIMAL(10,2) NOT NULL,
  "isActive"       BOOLEAN      NOT NULL DEFAULT true,
  "additionalInfo" JSONB        NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "society_employees_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "society_employees_societyId_idx" ON "society_employees"("societyId");
ALTER TABLE "society_employees"
  ADD CONSTRAINT "society_employees_societyId_fkey"
  FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "salary_records" (
  "id"               TEXT           NOT NULL,
  "societyId"        TEXT           NOT NULL,
  "employeeId"       TEXT           NOT NULL,
  "accountId"        TEXT,
  "salaryMonth"      INTEGER        NOT NULL,
  "salaryYear"       INTEGER        NOT NULL,
  "baseSalary"       DECIMAL(10,2)  NOT NULL,
  "additions"        DECIMAL(10,2)  NOT NULL DEFAULT 0,
  "deductions"       DECIMAL(10,2)  NOT NULL DEFAULT 0,
  "netSalary"        DECIMAL(10,2)  NOT NULL,
  "status"           "SalaryStatus" NOT NULL DEFAULT 'DRAFT',
  "paymentDate"      TIMESTAMP(3),
  "referenceNumber"  TEXT,
  "notes"            TEXT,
  "additionsDetail"  JSONB,
  "deductionsDetail" JSONB,
  "processedAt"      TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)   NOT NULL,
  CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "salary_records_societyId_employeeId_salaryMonth_salaryYear_key"
  ON "salary_records"("societyId","employeeId","salaryMonth","salaryYear");
CREATE INDEX "salary_records_societyId_idx" ON "salary_records"("societyId");
ALTER TABLE "salary_records"
  ADD CONSTRAINT "salary_records_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "society_employees"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "salary_records_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON UPDATE CASCADE;

-- ─── PAYMENTS ────────────────────────────────────────────────────────────────

CREATE TABLE "payment_submissions" (
  "id"                TEXT            NOT NULL,
  "societyId"         TEXT            NOT NULL,
  "flatId"            TEXT            NOT NULL,
  "userId"            TEXT            NOT NULL,
  "maintenanceBillId" TEXT,
  "billingPeriodId"   TEXT,
  "amount"            DECIMAL(12,2)   NOT NULL,
  "paymentDate"       TIMESTAMP(3)    NOT NULL,
  "paymentMethod"     "PaymentMethod" NOT NULL,
  "referenceNumber"   TEXT,
  "utrNumber"         TEXT,
  "bankName"          TEXT,
  "chequeNumber"      TEXT,
  "notes"             TEXT,
  "status"            "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedAt"        TIMESTAMP(3),
  "reviewedById"      TEXT,
  "reviewNotes"       TEXT,
  "approvedAt"        TIMESTAMP(3),
  "rejectedAt"        TIMESTAMP(3),
  "transactionId"     TEXT,
  "createdAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "payment_submissions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payment_submissions_societyId_idx" ON "payment_submissions"("societyId");
CREATE INDEX "payment_submissions_flatId_idx"    ON "payment_submissions"("flatId");
CREATE INDEX "payment_submissions_userId_idx"    ON "payment_submissions"("userId");
ALTER TABLE "payment_submissions"
  ADD CONSTRAINT "payment_submissions_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_submissions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_submissions_maintenanceBillId_fkey"
    FOREIGN KEY ("maintenanceBillId") REFERENCES "maintenance_bills"("id") ON UPDATE CASCADE;

-- ─── MONTHLY STATEMENTS ──────────────────────────────────────────────────────

CREATE TABLE "monthly_statements" (
  "id"                TEXT         NOT NULL,
  "societyId"         TEXT         NOT NULL,
  "billingPeriodId"   TEXT         NOT NULL,
  "title"             TEXT         NOT NULL,
  "periodYear"        INTEGER      NOT NULL,
  "periodMonth"       INTEGER      NOT NULL,
  "totalMaintenance"  DECIMAL(15,2) NOT NULL DEFAULT 0,
  "totalCollected"    DECIMAL(15,2) NOT NULL DEFAULT 0,
  "totalPending"      DECIMAL(15,2) NOT NULL DEFAULT 0,
  "totalExpenses"     DECIMAL(15,2) NOT NULL DEFAULT 0,
  "totalSalaries"     DECIMAL(15,2) NOT NULL DEFAULT 0,
  "totalWaterExpense" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "otherExpenses"     DECIMAL(15,2) NOT NULL DEFAULT 0,
  "content"           JSONB        NOT NULL DEFAULT '{}',
  "isPublished"       BOOLEAN      NOT NULL DEFAULT false,
  "publishedAt"       TIMESTAMP(3),
  "publishedById"     TEXT,
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "monthly_statements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "monthly_statements_billingPeriodId_key" ON "monthly_statements"("billingPeriodId");
CREATE INDEX "monthly_statements_societyId_idx" ON "monthly_statements"("societyId");
ALTER TABLE "monthly_statements"
  ADD CONSTRAINT "monthly_statements_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "monthly_statements_billingPeriodId_fkey"
    FOREIGN KEY ("billingPeriodId") REFERENCES "billing_periods"("id") ON UPDATE CASCADE;

-- ─── ANNOUNCEMENTS ───────────────────────────────────────────────────────────

CREATE TABLE "announcements" (
  "id"             TEXT                  NOT NULL,
  "societyId"      TEXT                  NOT NULL,
  "title"          TEXT                  NOT NULL,
  "content"        TEXT                  NOT NULL,
  "priority"       "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
  "audience"       "AnnouncementAudience" NOT NULL DEFAULT 'ALL_RESIDENTS',
  "audienceConfig" JSONB                 NOT NULL DEFAULT '{}',
  "publishAt"      TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  "isPublished"    BOOLEAN               NOT NULL DEFAULT false,
  "publishedAt"    TIMESTAMP(3),
  "createdById"    TEXT                  NOT NULL,
  "createdAt"      TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)          NOT NULL,
  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "announcements_societyId_idx" ON "announcements"("societyId");
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "announcements_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON UPDATE CASCADE;

-- ─── MEETINGS ────────────────────────────────────────────────────────────────

CREATE TABLE "meetings" (
  "id"          TEXT         NOT NULL,
  "societyId"   TEXT         NOT NULL,
  "title"       TEXT         NOT NULL,
  "meetingDate" TIMESTAMP(3) NOT NULL,
  "location"    TEXT,
  "agenda"      TEXT,
  "isPublished" BOOLEAN      NOT NULL DEFAULT false,
  "createdById" TEXT         NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "meetings_societyId_idx" ON "meetings"("societyId");
ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "meetings_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON UPDATE CASCADE;

CREATE TABLE "meeting_minutes" (
  "id"          TEXT         NOT NULL,
  "meetingId"   TEXT         NOT NULL,
  "content"     TEXT         NOT NULL,
  "summary"     TEXT,
  "isPublished" BOOLEAN      NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meeting_minutes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "meeting_minutes_meetingId_key" ON "meeting_minutes"("meetingId");
ALTER TABLE "meeting_minutes"
  ADD CONSTRAINT "meeting_minutes_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "meeting_attendees" (
  "id"        TEXT         NOT NULL,
  "meetingId" TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "flatCode"  TEXT,
  "role"      TEXT,
  "attended"  BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_attendees_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "meeting_attendees_meetingId_idx" ON "meeting_attendees"("meetingId");
ALTER TABLE "meeting_attendees"
  ADD CONSTRAINT "meeting_attendees_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── DOCUMENTS ───────────────────────────────────────────────────────────────

CREATE TABLE "documents" (
  "id"               TEXT                  NOT NULL,
  "societyId"        TEXT                  NOT NULL,
  "title"            TEXT                  NOT NULL,
  "description"      TEXT,
  "fileName"         TEXT                  NOT NULL,
  "fileKey"          TEXT                  NOT NULL,
  "fileSize"         INTEGER               NOT NULL,
  "mimeType"         TEXT                  NOT NULL,
  "storageProvider"  TEXT                  NOT NULL DEFAULT 'local',
  "accessLevel"      "DocumentAccessLevel" NOT NULL DEFAULT 'RESIDENTS_ONLY',
  "category"         TEXT,
  "linkedEntityType" TEXT,
  "linkedEntityId"   TEXT,
  "uploadedById"     TEXT                  NOT NULL,
  "isActive"         BOOLEAN               NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)          NOT NULL,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "documents_societyId_idx" ON "documents"("societyId");
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "documents_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON UPDATE CASCADE;

-- Implicit many-to-many join tables for Document relations

CREATE TABLE "_ExpenseDocuments" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_ExpenseDocuments_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_ExpenseDocuments_B_index" ON "_ExpenseDocuments"("B");

CREATE TABLE "_PaymentDocuments" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_PaymentDocuments_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_PaymentDocuments_B_index" ON "_PaymentDocuments"("B");

CREATE TABLE "_AnnouncementDocuments" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_AnnouncementDocuments_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_AnnouncementDocuments_B_index" ON "_AnnouncementDocuments"("B");

CREATE TABLE "_MeetingDocuments" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_MeetingDocuments_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_MeetingDocuments_B_index" ON "_MeetingDocuments"("B");

-- ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

CREATE TABLE "notifications" (
  "id"             TEXT                   NOT NULL,
  "societyId"      TEXT                   NOT NULL,
  "title"          TEXT                   NOT NULL,
  "body"           TEXT                   NOT NULL,
  "type"           TEXT                   NOT NULL,
  "data"           JSONB                  NOT NULL DEFAULT '{}',
  "channels"       "NotificationChannel"[] NOT NULL,
  "audience"       "AnnouncementAudience"  NOT NULL DEFAULT 'ALL_RESIDENTS',
  "audienceConfig" JSONB                  NOT NULL DEFAULT '{}',
  "scheduledAt"    TIMESTAMP(3),
  "sentAt"         TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_societyId_idx" ON "notifications"("societyId");
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_societyId_fkey"
  FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notification_records" (
  "id"             TEXT                 NOT NULL,
  "notificationId" TEXT                 NOT NULL,
  "userId"         TEXT                 NOT NULL,
  "channel"        "NotificationChannel" NOT NULL,
  "status"         "NotificationStatus"  NOT NULL DEFAULT 'PENDING',
  "sentAt"         TIMESTAMP(3),
  "readAt"         TIMESTAMP(3),
  "error"          TEXT,
  "createdAt"      TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)         NOT NULL,
  CONSTRAINT "notification_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notification_records_notificationId_idx" ON "notification_records"("notificationId");
CREATE INDEX "notification_records_userId_idx"         ON "notification_records"("userId");
ALTER TABLE "notification_records"
  ADD CONSTRAINT "notification_records_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notification_records_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON UPDATE CASCADE;

-- ─── AUDIT LOG ───────────────────────────────────────────────────────────────

CREATE TABLE "audit_logs" (
  "id"         TEXT          NOT NULL,
  "societyId"  TEXT,
  "actorId"    TEXT          NOT NULL,
  "action"     "AuditAction" NOT NULL,
  "entityType" TEXT,
  "entityId"   TEXT,
  "oldValues"  JSONB,
  "newValues"  JSONB,
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "metadata"   JSONB         NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_societyId_idx"           ON "audit_logs"("societyId");
CREATE INDEX "audit_logs_actorId_idx"             ON "audit_logs"("actorId");
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType","entityId");
CREATE INDEX "audit_logs_createdAt_idx"           ON "audit_logs"("createdAt");
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON UPDATE CASCADE,
  ADD CONSTRAINT "audit_logs_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id") ON UPDATE CASCADE;
