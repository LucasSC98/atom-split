import { AppError } from '../errors/AppError';
import { WalletRepository } from '../repositories/wallet.repository';

export class WalletService {
  constructor(private readonly walletRepository = new WalletRepository()) {}

  async getWalletStatement(walletId: string, page: number, limit: number) {
    const statement = await this.walletRepository.findStatementById(
      walletId,
      page,
      limit
    );

    if (!statement) {
      throw new AppError('Carteira não encontrada.', 404, 'WALLET_NOT_FOUND');
    }

    const { wallet, ledgerEntries, totalEntries } = statement;

    return {
      id: wallet.id,
      userId: wallet.userId,
      balanceCents: wallet.balanceCents,
      currency: wallet.currency,
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      user: wallet.user,
      ledgerEntries,
      pagination: {
        page,
        limit,
        total: totalEntries,
        totalPages: Math.ceil(totalEntries / limit),
      },
    };
  }
}

