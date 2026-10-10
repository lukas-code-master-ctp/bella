-- AlterTable
ALTER TABLE "SocialComment" ADD COLUMN "ruleId" TEXT,
ADD COLUMN "removedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CommentRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "channel" "Channel",
    "postId" TEXT,
    "postLabel" TEXT,
    "keywords" TEXT[],
    "publicReply" TEXT,
    "privateReply" TEXT,
    "hide" BOOLEAN NOT NULL DEFAULT false,
    "remove" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialComment_ruleId_idx" ON "SocialComment"("ruleId");

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommentRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
