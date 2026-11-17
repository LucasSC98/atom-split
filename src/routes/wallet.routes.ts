import { Router } from 'express';
import { WalletController } from '../controllers/wallet.controller';

const walletRoutes = Router();
const walletController = new WalletController();

walletRoutes.get('/:walletId/statement', walletController.getStatement);

export { walletRoutes };

