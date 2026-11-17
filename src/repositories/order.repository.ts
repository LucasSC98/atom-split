import {
  LedgerEntryType,
  LedgerReferenceType,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../config/database';
import {
  AppError,
  OptimisticLockError,
  OrderStatusConflictError,
} from '../errors';
import { CreateCheckoutInput } from '../schemas/order.schema';

export const orderDetailsSelect = {
  id: true,
  customerId: true,
  idempotencyKey: true,
  requestHash: true,
  totalAmountCents: true,
  currency: true,
  status: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      document: true,
      role: true,
    },
  },
  paymentSplits: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      orderId: true,
      recipientId: true,
      walletId: true,
      splitType: true,
      amountCents: true,
      feeBps: true,
      createdAt: true,
      recipient: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
  },
  ledgerEntries: {
    orderBy: { seq: 'asc' as const },
    select: {
      id: true,
      seq: true,
      walletId: true,
      orderId: true,
      paymentSplitId: true,
      type: true,
      referenceType: true,
      amountCents: true,
      balanceAfterCents: true,
      idempotencyKey: true,
      description: true,
      metadata: true,
      createdAt: true,
    },
  },
} satisfies Prisma.OrderSelect;

export type OrderWithDetails = Prisma.OrderGetPayload<{
  select: typeof orderDetailsSelect;
}>;

export class OrderRepository {
  async findByIdempotencyKey(
    customerId: string,
    idempotencyKey: string
  ): Promise<OrderWithDetails | null> {
    return prisma.order.findUnique({
      where: {
        customerId_idempotencyKey: {
          customerId,
          idempotencyKey,
        },
      },
      select: orderDetailsSelect,
    });
  }

  async findById(orderId: string): Promise<OrderWithDetails | null> {
    return prisma.order.findUnique({
      where: { id: orderId },
      select: orderDetailsSelect,
    });
  }

  async findAll(): Promise<OrderWithDetails[]> {
    return prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      select: orderDetailsSelect,
    });
  }

  async findActorsForCheckout(customerId: string, recipientIds: string[]) {
    const uniqueRecipientIds = Array.from(new Set(recipientIds));

    const [customer, recipients] = await Promise.all([
      prisma.user.findUnique({
        where: { id: customerId },
        select: { id: true, name: true, role: true },
      }),
      prisma.user.findMany({
        where: { id: { in: uniqueRecipientIds } },
        select: {
          id: true,
          name: true,
          role: true,
          wallet: {
            select: {
              id: true,
              balanceCents: true,
              version: true,
            },
          },
        },
      }),
    ]);

    return { customer, recipients };
  }

  async executeCheckoutTransaction(
    idempotencyKey: string,
    requestHash: string,
    input: CreateCheckoutInput
  ): Promise<OrderWithDetails> {
    const createdOrderId = await prisma.$transaction(async (tx) => {
      // a) Cria a Order com status PAID, idempotencyKey e requestHash
      const createdOrder = await tx.order.create({
        data: {
          customerId: input.customerId,
          idempotencyKey,
          requestHash,
          totalAmountCents: input.totalAmountCents,
          currency: 'BRL',
          status: OrderStatus.PAID,
          description: input.description,
        },
      });

      // b) Processa cada item do split de forma atômica
      for (const splitItem of input.splits) {
        const currentWallet = await tx.wallet.findUnique({
          where: { userId: splitItem.recipientId },
        });

        if (!currentWallet) {
          throw new AppError(
            `O recebedor ${splitItem.recipientId} não possui uma carteira ativa.`,
            422,
            'RECIPIENT_WALLET_NOT_FOUND'
          );
        }

        const paymentSplit = await tx.paymentSplit.create({
          data: {
            orderId: createdOrder.id,
            recipientId: splitItem.recipientId,
            walletId: currentWallet.id,
            splitType: splitItem.splitType,
            amountCents: splitItem.amountCents,
            feeBps: splitItem.feeBps,
          },
        });

        // Atualiza a Wallet com updateMany verificando a version lida (Optimistic Locking)
        const walletUpdate = await tx.wallet.updateMany({
          where: {
            id: currentWallet.id,
            version: currentWallet.version,
          },
          data: {
            balanceCents: { increment: splitItem.amountCents },
            version: { increment: 1 },
          },
        });

        if (walletUpdate.count === 0) {
          throw new OptimisticLockError(
            `Conflito de concorrência ao atualizar saldo da carteira ${currentWallet.id} (Optimistic Locking). Tente novamente.`
          );
        }

        const newBalanceCents =
          currentWallet.balanceCents + splitItem.amountCents;
        const newVersion = currentWallet.version + 1;

        await tx.ledgerEntry.create({
          data: {
            walletId: currentWallet.id,
            orderId: createdOrder.id,
            paymentSplitId: paymentSplit.id,
            type: LedgerEntryType.CREDIT,
            referenceType: LedgerReferenceType.ORDER_SPLIT,
            amountCents: splitItem.amountCents,
            balanceAfterCents: newBalanceCents,
            idempotencyKey: `${input.customerId}:${idempotencyKey}:split:${splitItem.recipientId}:${splitItem.splitType}`,
            description:
              input.description ??
              `Crédito de split (${splitItem.splitType}) referente ao pedido ${createdOrder.id}`,
            metadata: {
              splitType: splitItem.splitType,
              feeBps: splitItem.feeBps ?? null,
              previousBalanceCents: currentWallet.balanceCents,
              newBalanceCents,
              walletVersion: newVersion,
            },
          },
        });
      }

      return createdOrder.id;
    });

    return prisma.order.findUniqueOrThrow({
      where: { id: createdOrderId },
      select: orderDetailsSelect,
    });
  }

  async executeRefundTransaction(orderId: string): Promise<OrderWithDetails> {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          paymentSplits: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!order) {
        throw new AppError('Pedido não encontrado.', 404, 'ORDER_NOT_FOUND');
      }

      if (order.status === OrderStatus.REFUNDED) {
        throw new OrderStatusConflictError(
          `O pedido ${order.id} já se encontra com status REFUNDED.`
        );
      }

      if (order.status !== OrderStatus.PAID) {
        throw new AppError(
          `Apenas pedidos com status PAID podem ser estornados (status atual: ${order.status}).`,
          422,
          'INVALID_ORDER_STATUS_FOR_REFUND'
        );
      }

      // Garante a transição de status PAID -> REFUNDED via updateMany condicional
      const orderUpdate = await tx.order.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.PAID,
        },
        data: {
          status: OrderStatus.REFUNDED,
        },
      });

      if (orderUpdate.count === 0) {
        throw new OrderStatusConflictError(
          'Conflito de concorrência ao atualizar o status do pedido durante o estorno.'
        );
      }

      // Para cada PaymentSplit do pedido, verifica saldo e executa débito + lançamento imutável no Ledger
      for (const split of order.paymentSplits) {
        const currentWallet = await tx.wallet.findUnique({
          where: { id: split.walletId },
        });

        if (!currentWallet) {
          throw new AppError(
            `Carteira ${split.walletId} vinculada ao split ${split.id} não encontrada.`,
            422,
            'WALLET_NOT_FOUND_FOR_REFUND'
          );
        }

        if (currentWallet.balanceCents < split.amountCents) {
          throw new AppError(
            `Saldo insuficiente na carteira ${currentWallet.id} para estornar o split de ${split.amountCents} centavos (saldo disponível: ${currentWallet.balanceCents} centavos).`,
            422,
            'INSUFFICIENT_WALLET_BALANCE_FOR_REFUND'
          );
        }

        const walletUpdate = await tx.wallet.updateMany({
          where: {
            id: currentWallet.id,
            version: currentWallet.version,
          },
          data: {
            balanceCents: { decrement: split.amountCents },
            version: { increment: 1 },
          },
        });

        if (walletUpdate.count === 0) {
          throw new OptimisticLockError(
            `Conflito de concorrência ao processar estorno na carteira ${currentWallet.id} (Optimistic Locking). Tente novamente.`
          );
        }

        const newBalanceCents = currentWallet.balanceCents - split.amountCents;
        const newVersion = currentWallet.version + 1;

        await tx.ledgerEntry.create({
          data: {
            walletId: currentWallet.id,
            orderId: order.id,
            paymentSplitId: split.id,
            type: LedgerEntryType.DEBIT,
            referenceType: LedgerReferenceType.ORDER_REFUND,
            amountCents: split.amountCents,
            balanceAfterCents: newBalanceCents,
            idempotencyKey: `${order.idempotencyKey}:refund:${split.id}`,
            description: `Estorno referente ao pedido ${order.id}`,
            metadata: {
              splitType: split.splitType,
              previousBalanceCents: currentWallet.balanceCents,
              newBalanceCents,
              walletVersion: newVersion,
            },
          },
        });
      }
    });

    return prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: orderDetailsSelect,
    });
  }
}
