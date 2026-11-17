import {
  LedgerEntryType,
  LedgerReferenceType,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../errors/AppError';
import { CreateCheckoutInput } from '../schemas/order.schema';

export const orderDetailsSelect = {
  id: true,
  customerId: true,
  idempotencyKey: true,
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
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
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
  async findByIdempotencyKey(idempotencyKey: string): Promise<OrderWithDetails | null> {
    return prisma.order.findUnique({
      where: { idempotencyKey },
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
    input: CreateCheckoutInput
  ): Promise<OrderWithDetails> {
    return prisma.$transaction(async (tx) => {
      // a) Cria a Order com status PAID e a idempotencyKey
      const createdOrder = await tx.order.create({
        data: {
          customerId: input.customerId,
          idempotencyKey,
          totalAmountCents: input.totalAmountCents,
          currency: 'BRL',
          status: OrderStatus.PAID,
          description: input.description,
        },
      });

      // b) Processa cada item do split de forma atômica
      for (const splitItem of input.splits) {
        // Busca o estado atual da Wallet do recebedor dentro da transação
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

        // Cria o registro em PaymentSplit
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

        // Atualiza a Wallet com controle de concorrência otimista (verificando `version` lida)
        const updatedWallet = await tx.wallet.update({
          where: {
            id: currentWallet.id,
            version: currentWallet.version,
          },
          data: {
            balanceCents: { increment: splitItem.amountCents },
            version: { increment: 1 },
          },
        });

        // Cria o registro imutável em LedgerEntry com o snapshot exato do saldo (balanceAfterCents)
        await tx.ledgerEntry.create({
          data: {
            walletId: currentWallet.id,
            orderId: createdOrder.id,
            paymentSplitId: paymentSplit.id,
            type: LedgerEntryType.CREDIT,
            referenceType: LedgerReferenceType.ORDER_SPLIT,
            amountCents: splitItem.amountCents,
            balanceAfterCents: updatedWallet.balanceCents,
            idempotencyKey: `${idempotencyKey}:split:${paymentSplit.id}`,
            description:
              input.description ??
              `Crédito de split (${splitItem.splitType}) referente ao pedido ${createdOrder.id}`,
            metadata: {
              splitType: splitItem.splitType,
              feeBps: splitItem.feeBps ?? null,
              previousBalanceCents: currentWallet.balanceCents,
              newBalanceCents: updatedWallet.balanceCents,
              walletVersion: updatedWallet.version,
            },
          },
        });
      }

      // Retorna a Order completa com splits e lançamentos do Ledger
      const fullOrder = await tx.order.findUniqueOrThrow({
        where: { id: createdOrder.id },
        select: orderDetailsSelect,
      });

      return fullOrder;
    });
  }

  async executeRefundTransaction(orderId: string): Promise<OrderWithDetails> {
    return prisma.$transaction(async (tx) => {
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

      if (order.status !== OrderStatus.PAID) {
        throw new AppError(
          `Apenas pedidos com status PAID podem ser estornados (status atual: ${order.status}).`,
          422,
          'INVALID_ORDER_STATUS_FOR_REFUND'
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

        // Atualiza a Wallet decrementando amountCents e incrementando version (Optimistic Locking)
        const updatedWallet = await tx.wallet.update({
          where: {
            id: currentWallet.id,
            version: currentWallet.version,
          },
          data: {
            balanceCents: { decrement: split.amountCents },
            version: { increment: 1 },
          },
        });

        // Cria novo registro imutável DEBIT no LedgerEntry sem tocar nos registros anteriores
        await tx.ledgerEntry.create({
          data: {
            walletId: currentWallet.id,
            orderId: order.id,
            paymentSplitId: split.id,
            type: LedgerEntryType.DEBIT,
            referenceType: LedgerReferenceType.ORDER_REFUND,
            amountCents: split.amountCents,
            balanceAfterCents: updatedWallet.balanceCents,
            idempotencyKey: `${order.idempotencyKey}:refund:${split.id}`,
            description: `Estorno referente ao pedido ${order.id}`,
            metadata: {
              splitType: split.splitType,
              previousBalanceCents: currentWallet.balanceCents,
              newBalanceCents: updatedWallet.balanceCents,
              walletVersion: updatedWallet.version,
            },
          },
        });
      }

      // Atualiza o status da Order para REFUNDED garantindo que ainda estava PAID
      await tx.order.update({
        where: {
          id: order.id,
          status: OrderStatus.PAID,
        },
        data: {
          status: OrderStatus.REFUNDED,
        },
      });

      const refundedOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: orderDetailsSelect,
      });

      return refundedOrder;
    });
  }
}
