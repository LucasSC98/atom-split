import { Prisma } from '@prisma/client';

export interface OptimisticRetryOptions {
  /**
   * Número máximo de tentativas totais (incluindo a execução inicial).
   * Padrão: 3 tentativas.
   */
  maxAttempts?: number;
  /**
   * Backoff base em milissegundos entre tentativas.
   * Padrão: 20ms.
   */
  baseDelayMs?: number;
}

function isWalletVersionConflictError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  ) {
    const target = error.meta?.p2025Target ?? error.meta?.modelName;
    if (target === 'order' || target === 'Order') {
      return false;
    }
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Controla a janela de agendamento de retries para espalhar colisões simultâneas na hot wallet
let nextAvailableRetryWindowMs = 0;

/**
 * Executa uma transação com retry automático em caso de conflito de concorrência
 * otimista (`P2025` ao atualizar `version` de uma `Wallet`).
 *
 * POR QUE ESCOLHEMOS OPTIMISTIC LOCKING + RETRY EM VEZ DE `SELECT ... FOR UPDATE`:
 * 1. Ausência de Deadlocks Cruzados: Um pedido possui múltiplos splits (Plataforma + N Sellers).
 *    O uso de `SELECT ... FOR UPDATE` pode causar deadlocks se transações diferentes travarem
 *    carteiras em ordens distintas.
 * 2. Proteção de Throughput na Hot Wallet (Plataforma): A carteira `PLATFORM` recebe split em
 *    100% dos pedidos do marketplace. Um lock pessimista seguraria trava exclusiva no banco
 *    durante todos os roundtrips da transação interativa. Com Optimistic Locking (`version`) e
 *    retry com backoff + jitter, as leituras ocorrem sem bloqueio e eventuais colisões são
 *    reexecutadas em poucos milissegundos sem bloquear o pool de conexões.
 */
export async function withOptimisticRetry<T>(
  operation: () => Promise<T>,
  options: OptimisticRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 45;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isWalletVersionConflictError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const exponentialBackoff = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelayMs) + 5;
      const now = Date.now();
      const targetTime = Math.max(
        now + exponentialBackoff + jitter,
        nextAvailableRetryWindowMs + baseDelayMs + jitter
      );
      nextAvailableRetryWindowMs = targetTime;

      await sleep(targetTime - now);
    }
  }

  throw new Error('Unreachable retry state');
}
