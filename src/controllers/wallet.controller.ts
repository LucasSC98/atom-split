import { NextFunction, Request, Response } from 'express';
import {
  walletStatementParamsSchema,
  walletStatementQuerySchema,
} from '../schemas/wallet.schema';
import { WalletService } from '../services/wallet.service';

export class WalletController {
  constructor(private readonly walletService = new WalletService()) {}

  getStatement = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { walletId } = walletStatementParamsSchema.parse(req.params);
      const { page, limit } = walletStatementQuerySchema.parse(req.query);

      const statement = await this.walletService.getWalletStatement(
        walletId,
        page,
        limit
      );

      res.status(200).json(statement);
    } catch (error) {
      next(error);
    }
  };
}

