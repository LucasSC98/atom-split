-- ============================================================================
-- Tarefa 6: Imutabilidade do Ledger (Trigger BEFORE UPDATE OR DELETE) e CHECK Constraints
-- ============================================================================

-- 1. Função e Trigger que impedem qualquer UPDATE ou DELETE em ledger_entries
CREATE OR REPLACE FUNCTION prevent_ledger_entries_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Operação bloqueada: ledger é append-only (UPDATE e DELETE não são permitidos em ledger_entries).';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ledger_entries_mutation ON "ledger_entries";

CREATE TRIGGER trg_prevent_ledger_entries_mutation
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_entries_mutation();

-- 2. CHECK constraint para garantir saldo nunca negativo nas carteiras
ALTER TABLE "wallets"
ADD CONSTRAINT "wallets_balance_cents_check" CHECK ("balance_cents" >= 0);

-- 3. CHECK constraints para garantir valores estritamente positivos em centavos
ALTER TABLE "ledger_entries"
ADD CONSTRAINT "ledger_entries_amount_cents_check" CHECK ("amount_cents" > 0);

ALTER TABLE "payment_splits"
ADD CONSTRAINT "payment_splits_amount_cents_check" CHECK ("amount_cents" > 0);
