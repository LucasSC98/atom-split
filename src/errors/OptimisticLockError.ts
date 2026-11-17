import { AppError } from './AppError';

/**
 * Erro lançado quando uma atualização condicional na Wallet (`updateMany` com `version`)
 * retorna `count === 0`, indicando modificação concorrente da carteira.
 */
export class OptimisticLockError extends AppError {
  constructor(
    message = 'Conflito de concorrência ao atualizar saldo da carteira (Optimistic Locking). Tente novamente.'
  ) {
    super(message, 409, 'WALLET_CONCURRENCY_CONFLICT');
    this.name = 'OptimisticLockError';
    Object.setPrototypeOf(this, OptimisticLockError.prototype);
  }
}
