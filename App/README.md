# NG Home API

> **Multi-tenant Apartment Community Management SaaS**  
> Powered by **NovaGade**

---

## Architecture Overview

### Multi-Tenancy Model

Every tenant-owned entity carries a `societyId`. The backend enforces isolation via:

1. **JWT Token** — `societyId` is embedded in the access token at login. Users cannot inject a different `societyId`.
2. **TenantGuard** — Attached globally to all society-scoped routes. Reads `societyId` from the verified JWT, never from the request body.
3. **Service-layer filtering** — Every query includes `WHERE societyId = :societyId`. No cross-tenant leakage is possible at the service layer.
4. **Platform Admin** — A separate `isPlatformAdmin` flag allows platform-level access without a society context.

### Database Design

- PostgreSQL 18 via Coolify
- Prisma ORM with full type safety
- UUID primary keys throughout
- `Decimal` (not `Float`) for all financial amounts
- Soft deletes via `deletedAt` on critical entities
- Audit log for all financial operations

---

## Project Structure

```
nghome-api/
├── src/
│   ├── main.ts                  # Entry point — listens on 0.0.0.0
│   ├── app.module.ts            # Root module
│   ├── config/
│   │   └── configuration.ts     # Typed config via @nestjs/config
│   ├── prisma/
│   │   ├── prisma.service.ts    # Global PrismaClient
│   │   └── prisma.module.ts
│   ├── common/
│   │   ├── guards/              # JwtAuth, Roles, Tenant, PlatformAdmin
│   │   ├── decorators/          # @CurrentUser, @SocietyId, @Roles, @Public
│   │   ├── filters/             # GlobalExceptionFilter
│   │   ├── interceptors/        # Transform, Logging
│   │   ├── pipes/               # ParseUUID
│   │   └── utils/               # Pagination, InvoiceNumber
│   ├── auth/                    # JWT auth, refresh tokens, argon2
│   ├── users/                   # User management, society membership
│   ├── societies/               # Society CRUD + configuration
│   ├── buildings/               # Buildings and floors
│   ├── flats/                   # Flat/unit management
│   ├── billing-rules/           # Configurable billing rules
│   ├── billing/                 # Billing periods + calculation engine
│   ├── water/                   # Water billing (configurable models)
│   ├── payments/                # Payment submission + approval workflow
│   ├── accounts/                # Bank/cash accounts
│   ├── funds/                   # Society funds (Corpus, Sinking, etc.)
│   ├── transactions/            # Financial ledger
│   ├── expenses/                # Expense management
│   ├── salaries/                # Employee salary management
│   ├── statements/              # Monthly statements
│   ├── announcements/           # Society announcements
│   ├── meetings/                # Meeting minutes
│   ├── documents/               # Document metadata (storage-agnostic)
│   ├── notifications/           # Notification records (provider-agnostic)
│   ├── reports/                 # Reporting endpoints
│   ├── audit-logs/              # Immutable audit trail
│   └── health/                  # /health endpoint
├── prisma/
│   ├── schema.prisma            # Complete DB schema
│   └── seed.ts                  # Development seed
├── test/
│   └── tenant-isolation.spec.ts # Tenant isolation integration tests
├── Dockerfile
├── .env.example
└── README.md
```

---

## Billing Engine

The billing engine is fully configurable. Supported calculation types:

| Type | Description |
|---|---|
| `EQUAL_PER_FLAT` | Same amount for every flat |
| `AREA_BASED` | Rate × sq ft area |
| `PER_PERSON` | Rate × resident count |
| `HYBRID` | Base charge + area rate |
| `FIXED_CUSTOM` | Fixed custom charges |
| `PERCENTAGE_BASED` | Percentage of a base amount |
| `CUSTOM_FORMULA` | Future: plug-in formula evaluator |

**Key design principle:** Generated bills store a `calculationSnapshot` JSON capturing the exact rates, method, and quantities used. If a society changes its rules the following month, historical bills are unaffected.

---

## Payment Workflow

```
Resident submits payment → PENDING
Admin reviews → UNDER_REVIEW
Admin approves → APPROVED (atomically creates ledger Transaction, updates Account balance, updates Bill paid/pending amounts)
Admin rejects → REJECTED (no financial impact)
```

All approval steps are wrapped in a database transaction. If any step fails, everything rolls back.

---

## Water Billing

Configurable per society via `WaterBillingConfig`. Supported models:

- `PER_LITRE` / `PER_KL`
- `FIXED_CHARGE`
- `FIXED_PLUS_USAGE`
- `SLAB_BASED`
- `SOCIETY_ALLOCATION`
- `CUSTOM`

Individual water meter readings are stored per flat per billing period.

---

## Roles

| Role | Access |
|---|---|
| `PLATFORM_ADMIN` | Manage all societies, platform-level admin |
| `SOCIETY_ADMIN` | Full control within their society |
| `SOCIETY_ACCOUNTANT` | Financial operations within society |
| `SOCIETY_STAFF` | Limited operational access |
| `COMMITTEE_MEMBER` | Meeting/announcement management |
| `RESIDENT` | View own bills, announcements, submit payments |

---

## Quick Start (Development)

### Prerequisites

- Node.js 20+
- PostgreSQL 18 (local or Docker)

### 1. Clone & Install

```bash
git clone https://github.com/novagade/nghome-api
cd nghome-api
npm install
```

### 2. Environment

```bash
cp .env.example .env
# Edit .env with your local DB credentials
```

### 3. Database

```bash
npx prisma migrate dev --name init
```

### 4. Seed

```bash
npm run prisma:seed
```

### 5. Start

```bash
npm run start:dev
```

API: `http://localhost:3000/api/v1`  
Docs: `http://localhost:3000/docs`  
Health: `http://localhost:3000/health`

---

## Prisma Migrations

### Create initial migration

```bash
npx prisma migrate dev --name init
```

### Apply migrations (production)

```bash
npx prisma migrate deploy
```

### Regenerate client after schema change

```bash
npx prisma generate
```

### Reset database (dev only — DESTRUCTIVE)

```bash
npx prisma migrate reset
```

---

## Running Tests

```bash
# Unit tests
npm test

# Unit tests with coverage
npm run test:cov

# Tenant isolation integration tests (requires running DB)
npx jest test/tenant-isolation.spec.ts

# Billing calculator unit tests
npx jest src/billing/billing-calculator.service.spec.ts
```

---

## Docker

### Build

```bash
docker build -t nghome-api .
```

### Run (with external PostgreSQL)

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://nghome:password@your-db-host:5432/nghome" \
  -e JWT_ACCESS_SECRET="your-secret" \
  -e JWT_REFRESH_SECRET="your-refresh-secret" \
  nghome-api
```

The container runs Prisma migrations automatically on startup via:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
```

---

## Coolify Deployment

1. Push to GitHub: `git push origin main`
2. In Coolify: create a new application pointing to `ghcr.io/novagade/nghome-api` or your registry
3. Set environment variables in Coolify:

```
DATABASE_URL=postgresql://nghome:<password>@<coolify-internal-db-host>:5432/nghome
JWT_ACCESS_SECRET=<generated-secret>
JWT_REFRESH_SECRET=<generated-secret>
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://app.novagade.in
SWAGGER_ENABLED=false
```

4. The PostgreSQL database (`nghome-db` resource in Coolify) is private. Use the internal hostname provided by Coolify.
5. **Never expose the PostgreSQL port publicly.**

Production API: `https://nghome-api.novagade.in`

---

## What to Commit vs Not Commit

### ✅ Commit

- `src/` — All application code
- `prisma/schema.prisma` — Database schema
- `prisma/seed.ts` — Seed script (contains only demo data structure, no real secrets)
- `package.json`, `tsconfig*.json`, `nest-cli.json`
- `Dockerfile`, `.dockerignore`
- `.env.example` — Template only, no real values
- `.gitignore`
- `README.md`
- `test/`

### ❌ Do NOT Commit

- `.env` — Real environment variables
- `node_modules/`
- `dist/` — Build output
- Any file with real passwords, API keys, or JWT secrets
- `uploads/` — Local file uploads

---

## Future Extensions (Intentionally Not Built Yet)

The following are clean extension points — not implemented, but the architecture supports them:

| Feature | Extension Point |
|---|---|
| Payment gateway | `PaymentSubmission` → add `gatewayPaymentId`, `gatewayProvider` |
| Push notifications | `NotificationsService` → add FCM/APNs provider |
| Email notifications | `NotificationsService` → add SMTP/Resend provider |
| SMS / WhatsApp | `NotificationsService` → add Twilio/Meta provider |
| S3/R2/MinIO storage | `DocumentsService.storageProvider` field |
| GST accounting | New `GSTTransaction` model |
| Double-entry ledger | Extend `Transaction` with debit/credit accounts |
| Custom formula billing | `BillingCalculatorService.CUSTOM_FORMULA` case |
| Visitor management | New `Visitor` entity |
| Complaint management | New `Complaint` entity |
| Maintenance requests | New `MaintenanceRequest` entity |

---

## API Conventions

- All responses are wrapped: `{ success: true, data: ... }` or `{ success: false, message: ..., statusCode: ... }`
- Paginated responses: `{ data: [...], meta: { total, page, limit, totalPages } }`
- All timestamps in UTC ISO 8601
- All financial amounts as strings (Prisma Decimal serializes to string — never float)
- Authentication via `Authorization: Bearer <token>`

---

*NG Home API — Built with NestJS + Prisma + PostgreSQL*  
*© NovaGade. All rights reserved.*
