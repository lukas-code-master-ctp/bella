-- CreateTable
CREATE TABLE "SocialComment" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "postId" TEXT,
    "parentId" TEXT,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "privateReply" TEXT,
    "privateAt" TIMESTAMP(3),
    "repliedById" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "SocialComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialComment_externalId_key" ON "SocialComment"("externalId");

-- CreateIndex
CREATE INDEX "SocialComment_doneAt_createdAt_idx" ON "SocialComment"("doneAt", "createdAt");

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_repliedById_fkey" FOREIGN KEY ("repliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

