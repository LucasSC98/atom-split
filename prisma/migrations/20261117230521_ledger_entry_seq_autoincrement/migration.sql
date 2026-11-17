-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_id_seq_idx" ON "ledger_entries"("wallet_id", "seq");
