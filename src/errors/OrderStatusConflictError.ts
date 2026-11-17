import { AppError } from './AppError';

/**
 * Erro lançado quando a transição condicional de status de uma Order (`updateMany` com `status`)
 * retorna `count === 0`, indicando que outra transação concorrente alterou o status do pedido.
 */
export class OrderStatusConflictError extends AppError {
  constructor(
    message = 'Conflito de concorrência ao atualizar o status do pedido.'
  ) {
    super(message, 409, 'ORDER_STATUS_CONCURRENCY_CONFLICT');
    this.name = 'OrderStatusConflictError';
    Object.setPrototypeOf(this, OrderStatusConflictError.prototype);
  }
}
