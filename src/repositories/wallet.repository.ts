import { prisma } from '../config/database';

export class WalletRepository {
  async findStatementById(walletId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [wallet, ledgerEntries, totalEntries] = await prisma.$transaction([
      prisma.wallet.findUnique({
        where: { id: walletId },
        select: {
          id: true,
          userId: true,
          balanceCents: true,
          currency: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              document: true,
              role: true,
            },
          },
        },
      }),
      prisma.ledgerEntry.findMany({
        where: { walletId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
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
      }),
      prisma.ledgerEntry.count({
        where: { walletId },
      }),
    ]);

    if (!wallet) {
      return null;
    }

    return {
      wallet,
      ledgerEntries,
      totalEntries,
    };
  }
}

