ALTER TABLE "Task" ADD COLUMN "code" TEXT;
ALTER TABLE "Task" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'lesson';
ALTER TABLE "Task" ADD COLUMN "completionMethod" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Task" ADD COLUMN "balanceThreshold" REAL;

CREATE UNIQUE INDEX "Task_code_key" ON "Task"("code");
