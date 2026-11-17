import request from 'supertest';
import {
  LedgerEntryType,
  LedgerReferenceType,
  OrderStatus,
  SplitType,
  UserRole,
} from '@prisma/client';
import { app } from '../app';
import { prisma } from '../config/database';
import { computeCheckoutRequestHash } from '../services/order.service';

jest.mock('../config/database', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    paymentSplit: {
      create: jest.fn(),
    },
    ledgerEntry: {
      create: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Etapa 3: Orders & Split Checkout Module', () => {
  const customerId = 'f305e6a6-0da5-4abb-9fa4-8e816228fa98';
  const platformId = 'dbea58c9-afcf-44ea-a228-cb1f963f8ab3';
  const sellerAId = 'b710cd48-f843-4318-b042-3f68d9751a90';
  const sellerBId = 'b9f92025-d079-4237-90ae-e48f482827be';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/orders/checkout', () => {
    it('deve retornar HTTP 400 se o header Idempotency-Key não for enviado', async () => {
      const response = await request(app)
        .post('/api/orders/checkout')
        .send({
          customerId,
          totalAmountCents: 10000,
          splits: [
            {
              recipientId: sellerAId,
              splitType: 'SELLER_SHARE',
              amountCents: 10000,
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    it('deve retornar HTTP 422 (Zero-Sum) se a soma dos splits diferir em 1 centavo do totalAmountCents', async () => {
      (mockedPrisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/orders/checkout')
        .set('Idempotency-Key', 'idem-zero-sum-fail')
        .send({
          customerId,
          totalAmountCents: 10000,
          splits: [
            {
              recipientId: platformId,
              splitType: 'PLATFORM_FEE',
              amountCents: 1500,
              feeBps: 1500,
            },
            {
              recipientId: sellerAId,
              splitType: 'SELLER_SHARE',
              amountCents: 5000,
            },
            {
              recipientId: sellerBId,
              splitType: 'SELLER_SHARE',
              amountCents: 3499, // Faltando 1 centavo (soma = 9999 != 10000)
            },
          ],
        });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('INVALID_SPLIT_SUM');
    });

    it('deve retornar HTTP 200 com X-Idempotent-Replayed: true se a Idempotency-Key já foi processada com o mesmo payload', async () => {
      const payload = {
        customerId,
        totalAmountCents: 10000,
        splits: [
          {
            recipientId: sellerAId,
            splitType: SplitType.SELLER_SHARE,
            amountCents: 10000,
          },
        ],
      };

      const existingOrder = {
        id: '11111111-2222-3333-4444-555555555555',
        customerId,
        idempotencyKey: 'idem-already-processed',
        requestHash: computeCheckoutRequestHash(payload),
        totalAmountCents: 10000,
        currency: 'BRL',
        status: OrderStatus.PAID,
        paymentSplits: [],
        ledgerEntries: [],
      };

      (mockedPrisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);

      const response = await request(app)
        .post('/api/orders/checkout')
        .set('Idempotency-Key', 'idem-already-processed')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.headers['x-idempotent-replayed']).toBe('true');
      expect(response.body.idempotentReplayed).toBe(true);
      expect(response.body.order.id).toBe(existingOrder.id);
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('deve retornar HTTP 422 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD se a mesma chave for reusada com payload diferente', async () => {
      const existingOrder = {
        id: '11111111-2222-3333-4444-555555555555',
        customerId,
        idempotencyKey: 'idem-reused-diff-payload',
        requestHash: 'hash-diferente-do-payload-atual',
        totalAmountCents: 10000,
        currency: 'BRL',
        status: OrderStatus.PAID,
        paymentSplits: [],
        ledgerEntries: [],
      };

      (mockedPrisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);

      const response = await request(app)
        .post('/api/orders/checkout')
        .set('Idempotency-Key', 'idem-reused-diff-payload')
        .send({
          customerId,
          totalAmountCents: 10000,
          splits: [
            {
              recipientId: sellerAId,
              splitType: SplitType.SELLER_SHARE,
              amountCents: 10000,
            },
          ],
        });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    });

    it('deve processar o checkout atomicamente criando Order, PaymentSplits, atualizando Wallets com version e gravando LedgerEntries', async () => {
      (mockedPrisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: customerId,
        name: 'Cliente Teste',
        role: UserRole.CUSTOMER,
      });

      (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([
        {
          id: platformId,
          name: 'AtomicSplit Marketplace',
          role: UserRole.PLATFORM,
          wallet: { id: 'wallet-platform', balanceCents: 0, version: 1 },
        },
        {
          id: sellerAId,
          name: 'Tech Store Brasil',
          role: UserRole.SELLER,
          wallet: { id: 'wallet-seller-a', balanceCents: 0, version: 1 },
        },
      ]);

      (mockedPrisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockedPrisma);
      });

      (mockedPrisma.order.create as jest.Mock).mockResolvedValue({
        id: 'order-uuid-1',
        customerId,
        idempotencyKey: 'idem-new-checkout',
        totalAmountCents: 10000,
        currency: 'BRL',
        status: OrderStatus.PAID,
      });

      (mockedPrisma.wallet.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 'wallet-platform',
          userId: platformId,
          balanceCents: 0,
          version: 1,
        })
        .mockResolvedValueOnce({
          id: 'wallet-seller-a',
          userId: sellerAId,
          balanceCents: 0,
          version: 1,
        });

      (mockedPrisma.paymentSplit.create as jest.Mock)
        .mockResolvedValueOnce({ id: 'split-1' })
        .mockResolvedValueOnce({ id: 'split-2' });

      (mockedPrisma.wallet.update as jest.Mock)
        .mockResolvedValueOnce({
          id: 'wallet-platform',
          balanceCents: 1500,
          version: 2,
        })
        .mockResolvedValueOnce({
          id: 'wallet-seller-a',
          balanceCents: 8500,
          version: 2,
        });

      (mockedPrisma.ledgerEntry.create as jest.Mock).mockResolvedValue({});

      (mockedPrisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        id: 'order-uuid-1',
        customerId,
        idempotencyKey: 'idem-new-checkout',
        totalAmountCents: 10000,
        currency: 'BRL',
        status: OrderStatus.PAID,
        paymentSplits: [{ id: 'split-1' }, { id: 'split-2' }],
        ledgerEntries: [{ id: 'ledger-1' }, { id: 'ledger-2' }],
      });

      const response = await request(app)
        .post('/api/orders/checkout')
        .set('Idempotency-Key', 'idem-new-checkout')
        .send({
          customerId,
          totalAmountCents: 10000,
          description: 'Compra Marketplace',
          splits: [
            {
              recipientId: platformId,
              splitType: 'PLATFORM_FEE',
              amountCents: 1500,
              feeBps: 1500,
            },
            {
              recipientId: sellerAId,
              splitType: 'SELLER_SHARE',
              amountCents: 8500,
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.headers['x-idempotent-replayed']).toBe('false');
      expect(response.body.idempotentReplayed).toBe(false);
      expect(mockedPrisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-platform', version: 1 },
        data: { balanceCents: { increment: 1500 }, version: { increment: 1 } },
      });
      expect(mockedPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletId: 'wallet-platform',
            orderId: 'order-uuid-1',
            paymentSplitId: 'split-1',
            type: LedgerEntryType.CREDIT,
            referenceType: LedgerReferenceType.ORDER_SPLIT,
            amountCents: 1500,
            balanceAfterCents: 1500,
            idempotencyKey: `${customerId}:idem-new-checkout:split:${platformId}:PLATFORM_FEE`,
          }),
        })
      );
    });
  });
});

