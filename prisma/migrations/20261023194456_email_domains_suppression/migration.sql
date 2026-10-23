-- CreateEnum
CREATE TYPE "EmailSuppressionReason" AS ENUM ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED');

-- CreateTable
CREATE TABLE "EmailDomain" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "domain" TEXT NOT NULL,
    "resendId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "records" JSONB NOT NULL DEFAULT '[]',
    "fromName" TEXT NOT NULL,
    "fromLocal" TEXT NOT NULL DEFAULT 'noticias',
    "replyTo" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "EmailDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "email" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailDomain_companyId_key" ON "EmailDomain"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDomain_domain_key" ON "EmailDomain"("domain");

-- CreateIndex
CREATE INDEX "EmailSuppression_companyId_createdAt_idx" ON "EmailSuppression"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_companyId_email_key" ON "EmailSuppression"("companyId", "email");
