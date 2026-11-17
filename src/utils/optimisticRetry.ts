import { OptimisticLockError } from '../errors/OptimisticLockError';

export interface OptimisticRetryOptions {
  /**
   * Número máximo de tentativas totais (incluindo a execução inicial).
   * Padrão: 8 tentativas.
   */
  maxAttempts?: number;
  /**
   * Backoff base em milissegundos (dobrando a cada tentativa).
   * Padrão: 10ms.
   */
  baseDelayMs?: number;
  /**
   * Teto máximo do backoff exponencial em milissegundos.
   * Padrão: 200ms.
   */
  maxDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reexecuta a operação transacional inteira SOMENTE quando ocorre `OptimisticLockError`
 * (conflito de `version` na atualização da `Wallet`).
 *
 * POR QUE ESCOLHEMOS OPTIMISTIC LOCKING + RETRY EM VEZ DE `SELECT ... FOR UPDATE` (E SEU CUSTO):
 * 1. Prevenção de Deadlocks: Um checkout ou estorno atualiza múltiplas carteiras na mesma
 *    transação (Plataforma + N Sellers). Com locks pessimistas (`SELECT ... FOR UPDATE`),
 *    transações concorrentes adquirindo locks em ordens diferentes causam deadlocks no banco.
 * 2. Trade-off e Custo Real em Hot Wallet: Como a carteira `PLATFORM` recebe comissão em 100%
 *    dos pedidos do marketplace, ela é uma "hot wallet". Sob alta concorrência, o Optimistic
 *    Locking (`version`) inevitavelmente gera colisões (`count === 0` no `updateMany`), abortando
 *    a transação perdedora. O retry com backoff exponencial + jitter é o preço pago por essa
 *    escolha: trocamos filas de espera de locks exclusivos no banco por reexecuções curtas na
 *    aplicação, mantendo leituras livres de bloqueio.
 */
export async function withOptimisticRetry<T>(
  operation: () => Promise<T>,
  options: OptimisticRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 8;
  const baseDelayMs = options.baseDelayMs ?? 10;
  const maxDelayMs = options.maxDelayMs ?? 200;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof OptimisticLockError) || attempt >= maxAttempts) {
        throw error;
      }

      // Backoff exponencial (base 10ms, dobrando até o teto de 200ms) + jitter aleatório
      const exponentialDelay = Math.min(
        maxDelayMs,
        baseDelayMs * Math.pow(2, attempt - 1)
      );
      const jitter = Math.floor(Math.random() * maxDelayMs);
      const totalDelayMs = exponentialDelay + jitter;

      await sleep(totalDelayMs);
    }
  }

  throw new OptimisticLockError();
}
