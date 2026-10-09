-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assigneeId" TEXT,
    "createdBy" "Actor" NOT NULL,
    "createdById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_assigneeId_completedAt_dueAt_idx" ON "Task"("assigneeId", "completedAt", "dueAt");

-- CreateIndex
CREATE INDEX "Task_leadId_idx" ON "Task"("leadId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
