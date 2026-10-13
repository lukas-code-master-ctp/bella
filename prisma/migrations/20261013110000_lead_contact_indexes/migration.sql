-- CreateIndex
CREATE INDEX "Contact_companyId_phone_idx" ON "Contact"("companyId", "phone");

-- CreateIndex
CREATE INDEX "Contact_companyId_email_idx" ON "Contact"("companyId", "email");

-- CreateIndex
CREATE INDEX "Lead_contactId_status_idx" ON "Lead"("contactId", "status");
