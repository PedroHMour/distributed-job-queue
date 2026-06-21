-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('EMAIL_DELIVERY', 'IMAGE_PROCESSING', 'REPORT_GENERATION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'FAILED', 'RETRYING', 'DEAD');

-- CreateTable
CREATE TABLE "job_executions" (
    "id" TEXT NOT NULL,
    "bullmq_job_id" TEXT NOT NULL,
    "job_type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "input_payload" JSONB NOT NULL,
    "output_payload" JSONB,
    "attempt_number" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error_message" TEXT,
    "error_stack" TEXT,
    "enqueued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "processing_ms" INTEGER,
    "worker_instance_id" TEXT,

    CONSTRAINT "job_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_entries" (
    "id" TEXT NOT NULL,
    "job_execution_id" TEXT NOT NULL,
    "bullmq_job_id" TEXT NOT NULL,
    "job_type" "JobType" NOT NULL,
    "input_payload" JSONB NOT NULL,
    "failure_history" JSONB NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letter_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_executions_bullmq_job_id_key" ON "job_executions"("bullmq_job_id");

-- CreateIndex
CREATE INDEX "job_executions_status_idx" ON "job_executions"("status");

-- CreateIndex
CREATE INDEX "job_executions_job_type_idx" ON "job_executions"("job_type");

-- CreateIndex
CREATE INDEX "job_executions_enqueued_at_idx" ON "job_executions"("enqueued_at");

-- CreateIndex
CREATE INDEX "job_executions_status_job_type_idx" ON "job_executions"("status", "job_type");

-- CreateIndex
CREATE UNIQUE INDEX "dead_letter_entries_job_execution_id_key" ON "dead_letter_entries"("job_execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "dead_letter_entries_bullmq_job_id_key" ON "dead_letter_entries"("bullmq_job_id");

-- CreateIndex
CREATE INDEX "dead_letter_entries_resolved_at_idx" ON "dead_letter_entries"("resolved_at");

-- CreateIndex
CREATE INDEX "dead_letter_entries_job_type_idx" ON "dead_letter_entries"("job_type");

-- AddForeignKey
ALTER TABLE "dead_letter_entries" ADD CONSTRAINT "dead_letter_entries_job_execution_id_fkey" FOREIGN KEY ("job_execution_id") REFERENCES "job_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
