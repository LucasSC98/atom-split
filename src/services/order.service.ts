import { OrderStatus, Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError';
import { OrderRepository, OrderWithDetails } from '../repositories/order.repository';
import { CreateCheckoutInput } from '../schemas/order.schema';

export interface CheckoutResult {
  order: OrderWithDetails;
  idempotentReplayed: boolean;
}

export interface RefundResult {
  order: OrderWithDetails;
  idempotentReplayed: boolean;
}

export class OrderService {
  constructor(private readonly orderRepository = new OrderRepository()) {}

  async processCheckout(
    idempotencyKey: string,
    input: CreateCheckoutInput
  ): Promise<CheckoutResult> {
    // 1. Idempotência Segura: verifica se já existe uma Order com a mesma idempotencyKey
    const existingOrder =
      await this.orderRepository.findByIdempotencyKey(idempotencyKey);

    if (existingOrder) {
      return {
        order: existingOrder,
        idempotentReplayed: true,
      };
    }

    // 2. Validação Matemática de Centavos (Zero-Sum):
    // A soma exata dos splits DEVE ser estritamente igual ao totalAmountCents
    const splitsSumCents = input.splits.reduce(
      (sum, item) => sum + item.amountCents,
      0
    );

    if (splitsSumCents !== input.totalAmountCents) {
      throw new AppError(
        `Inconsistência matemática no split (Zero-Sum): a soma dos splits (${splitsSumCents} centavos) difere do valor total do pedido (${input.totalAmountCents} centavos).`,
        422,
        'INVALID_SPLIT_SUM'
      );
    }

    // 3. Validação de Atores: customerId deve existir e todos os recipientId devem existir e possuir Wallet
    const recipientIds = input.splits.map((s) => s.recipientId);
    const { customer, recipients } =
      await this.orderRepository.findActorsForCheckout(
        input.customerId,
        recipientIds
      );

    if (!customer) {
      throw new AppError(
        `Comprador (customerId: ${input.customerId}) não encontrado.`,
        404,
        'CUSTOMER_NOT_FOUND'
      );
    }

    const recipientsMap = new Map(recipients.map((r) => [r.id, r]));

    for (const splitItem of input.splits) {
      const recipient = recipientsMap.get(splitItem.recipientId);

      if (!recipient) {
        throw new AppError(
          `Recebedor (recipientId: ${splitItem.recipientId}) não encontrado.`,
          404,
          'RECIPIENT_NOT_FOUND'
        );
      }

      if (!recipient.wallet) {
        throw new AppError(
          `O recebedor "${recipient.name}" (${recipient.id}) não possui uma Wallet associada para receber splits.`,
          422,
          'RECIPIENT_WALLET_MISSING'
        );
      }
    }

    // 4. Execução Atômica (prisma.$transaction) com tratamento de concorrência
    try {
      const order = await this.orderRepository.executeCheckoutTransaction(
        idempotencyKey,
        input
      );

      return {
        order,
        idempotentReplayed: false,
      };
    } catch (error) {
      // Se duas requisições concorrentes com a mesma Idempotency-Key baterem juntas no banco:
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrentOrder =
          await this.orderRepository.findByIdempotencyKey(idempotencyKey);
        if (concurrentOrder) {
          return {
            order: concurrentOrder,
            idempotentReplayed: true,
          };
        }
      }

      // Se a trava de concorrência otimista (version da Wallet) falhar:
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new AppError(
          'Conflito de concorrência ao atualizar saldo da carteira (Optimistic Locking). Tente novamente.',
          409,
          'WALLET_CONCURRENCY_CONFLICT'
        );
      }

      throw error;
    }
  }

  async refundOrder(orderId: string): Promise<RefundResult> {
    // 1. Busca a Order atual e verifica estado / idempotência
    const existingOrder = await this.orderRepository.findById(orderId);

    if (!existingOrder) {
      throw new AppError('Pedido não encontrado.', 404, 'ORDER_NOT_FOUND');
    }

    if (existingOrder.status === OrderStatus.REFUNDED) {
      return {
        order: existingOrder,
        idempotentReplayed: true,
      };
    }

    if (existingOrder.status !== OrderStatus.PAID) {
      throw new AppError(
        `Apenas pedidos com status PAID podem ser estornados (status atual: ${existingOrder.status}).`,
        422,
        'INVALID_ORDER_STATUS_FOR_REFUND'
      );
    }

    // 2. Execução Atômica do Estorno (DEBIT no Ledger + decremento nas Wallets + Order REFUNDED)
    try {
      const refundedOrder =
        await this.orderRepository.executeRefundTransaction(orderId);

      return {
        order: refundedOrder,
        idempotentReplayed: false,
      };
    } catch (error) {
      // Se outra requisição paralela já estornou o mesmo pedido (violação de unique key na idempotencyKey do refund):
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const currentOrder = await this.orderRepository.findById(orderId);
        if (currentOrder && currentOrder.status === OrderStatus.REFUNDED) {
          return {
            order: currentOrder,
            idempotentReplayed: true,
          };
        }
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new AppError(
          'Conflito de concorrência ao processar estorno na carteira (Optimistic Locking). Tente novamente.',
          409,
          'WALLET_CONCURRENCY_CONFLICT'
        );
      }

      throw error;
    }
  }

  async getOrderById(orderId: string): Promise<OrderWithDetails> {
    const order = await this.orderRepository.findById(orderId);

    if (!order) {
      throw new AppError('Pedido não encontrado.', 404, 'ORDER_NOT_FOUND');
    }

    return order;
  }

  async listOrders(): Promise<OrderWithDetails[]> {
    return this.orderRepository.findAll();
  }
}
