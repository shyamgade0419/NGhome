-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'CIVIL', 'CLEANING', 'SECURITY', 'ELEVATOR', 'CARPENTRY', 'PEST_CONTROL', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MaintenanceRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id"            TEXT NOT NULL,
    "societyId"     TEXT NOT NULL,
    "flatId"        TEXT,
    "residentId"    TEXT NOT NULL,
    "assignedToId"  TEXT,
    "title"         TEXT NOT NULL,
    "description"   TEXT,
    "category"      "MaintenanceCategory"      NOT NULL DEFAULT 'OTHER',
    "priority"      "MaintenancePriority"      NOT NULL DEFAULT 'MEDIUM',
    "status"        "MaintenanceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "adminNotes"    TEXT,
    "resolvedAt"    TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_requests_societyId_idx" ON "maintenance_requests"("societyId");

-- CreateIndex
CREATE INDEX "maintenance_requests_residentId_idx" ON "maintenance_requests"("residentId");

-- CreateIndex
CREATE INDEX "maintenance_requests_status_idx" ON "maintenance_requests"("status");

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_residentId_fkey"
    FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
