-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "MessageEventType" AS ENUM ('DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT', 'MANUAL', 'SMS_STOP');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'EXITED', 'FAILED');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'EMAIL',
    "templateId" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "segmentId" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT,
    "campaignId" TEXT,
    "automationRunId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "direction" "MessageDirection" NOT NULL DEFAULT 'OUTBOUND',
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "toAddress" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "providerName" TEXT,
    "providerMessageId" TEXT,
    "suppressedReason" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "MessageEventType" NOT NULL,
    "url" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT,
    "ipAddress" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assignedUserId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "activeVersionId" TEXT,
    "allowReentry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationVersion" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "currentNodeId" TEXT,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "resumeAt" TIMESTAMP(3),
    "context" JSONB,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeKind" TEXT NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Job_runAt_lockedAt_completedAt_idx" ON "Job"("runAt", "lockedAt", "completedAt");

-- CreateIndex
CREATE INDEX "Job_workspaceId_idx" ON "Job"("workspaceId");

-- CreateIndex
CREATE INDEX "EmailTemplate_workspaceId_idx" ON "EmailTemplate"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_workspaceId_name_key" ON "EmailTemplate"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_status_idx" ON "Campaign"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_workspaceId_name_key" ON "Campaign"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Message_workspaceId_createdAt_idx" ON "Message"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_contactId_createdAt_idx" ON "Message"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_campaignId_idx" ON "Message"("campaignId");

-- CreateIndex
CREATE INDEX "Message_providerMessageId_idx" ON "Message"("providerMessageId");

-- CreateIndex
CREATE INDEX "MessageEvent_messageId_occurredAt_idx" ON "MessageEvent"("messageId", "occurredAt");

-- CreateIndex
CREATE INDEX "Suppression_workspaceId_idx" ON "Suppression"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_workspaceId_channel_address_key" ON "Suppression"("workspaceId", "channel", "address");

-- CreateIndex
CREATE INDEX "ConsentRecord_workspaceId_contactId_channel_idx" ON "ConsentRecord"("workspaceId", "contactId", "channel");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_lastMessageAt_idx" ON "Conversation"("workspaceId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_workspaceId_contactId_channel_key" ON "Conversation"("workspaceId", "contactId", "channel");

-- CreateIndex
CREATE INDEX "Automation_workspaceId_status_idx" ON "Automation"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Automation_workspaceId_name_key" ON "Automation"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationVersion_automationId_version_key" ON "AutomationVersion"("automationId", "version");

-- CreateIndex
CREATE INDEX "AutomationRun_status_resumeAt_idx" ON "AutomationRun"("status", "resumeAt");

-- CreateIndex
CREATE INDEX "AutomationRun_workspaceId_startedAt_idx" ON "AutomationRun"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "AutomationRun_automationId_contactId_idx" ON "AutomationRun"("automationId", "contactId");

-- CreateIndex
CREATE INDEX "AutomationRunStep_runId_occurredAt_idx" ON "AutomationRunStep"("runId", "occurredAt");

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_automationRunId_fkey" FOREIGN KEY ("automationRunId") REFERENCES "AutomationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEvent" ADD CONSTRAINT "MessageEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationVersion" ADD CONSTRAINT "AutomationVersion_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRunStep" ADD CONSTRAINT "AutomationRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
