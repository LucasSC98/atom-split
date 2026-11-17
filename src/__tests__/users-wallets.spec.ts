import request from 'supertest';
import { UserRole, LedgerEntryType, LedgerReferenceType } from '@prisma/client';
import { app } from '../app';
import { prisma } from '../config/database';

jest.mock('../config/database', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
    },
    ledgerEntry: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Etapa 2: Users & Wallets Modules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/users', () => {
    it('deve criar um usuário SELLER com Wallet atômica e limpar pontuação do documento', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const createdSeller = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Loja Exemplo LTDA',
        email: 'contato@lojaexemplo.com.br',
        document: '12345678000199',
        role: UserRole.SELLER,
        createdAt: new Date('2026-11-17T18:00:00.000Z'),
        updatedAt: new Date('2026-11-17T18:00:00.000Z'),
        wallet: {
          id: '660e8400-e29b-41d4-a716-446655440001',
          balanceCents: 0,
          currency: 'BRL',
          version: 1,
          createdAt: new Date('2026-11-17T18:00:00.000Z'),
          updatedAt: new Date('2026-11-17T18:00:00.000Z'),
        },
      };

      (mockedPrisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        if (typeof cb === 'function') {
          return cb(mockedPrisma);
        }
        return Promise.all(cb);
      });
      (mockedPrisma.user.create as jest.Mock).mockResolvedValue(createdSeller);

      const response = await request(app).post('/api/users').send({
        name: 'Loja Exemplo LTDA',
        email: 'CONTATO@lojaexemplo.com.br',
        document: '12.345.678/0001-99',
        role: 'SELLER',
      });

      expect(response.status).toBe(201);
      expect(response.body.document).toBe('12345678000199');
      expect(response.body.wallet).toBeDefined();
      expect(response.body.wallet.balanceCents).toBe(0);
      expect(response.body.wallet.currency).toBe('BRL');
      expect(response.body.wallet.version).toBe(1);

      expect(mockedPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'contato@lojaexemplo.com.br',
            document: '12345678000199',
            role: 'SELLER',
            wallet: {
              create: {
                balanceCents: 0,
                currency: 'BRL',
                version: 1,
              },
            },
          }),
        })
      );
    });

    it('deve criar um usuário CUSTOMER sem criar Wallet', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const createdCustomer = {
        id: '550e8400-e29b-41d4-a716-446655440002',
        name: 'Cliente Comprador',
        email: 'cliente@email.com',
        document: '12345678901',
        role: UserRole.CUSTOMER,
        createdAt: new Date('2026-11-17T18:00:00.000Z'),
        updatedAt: new Date('2026-11-17T18:00:00.000Z'),
        wallet: null,
      };

      (mockedPrisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        if (typeof cb === 'function') {
          return cb(mockedPrisma);
        }
        return Promise.all(cb);
      });
      (mockedPrisma.user.create as jest.Mock).mockResolvedValue(createdCustomer);

      const response = await request(app).post('/api/users').send({
        name: 'Cliente Comprador',
        email: 'cliente@email.com',
        document: '123.456.789-01',
        role: 'CUSTOMER',
      });

      expect(response.status).toBe(201);
      expect(response.body.document).toBe('12345678901');
      expect(response.body.wallet).toBeNull();
      expect(mockedPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Cliente Comprador',
            email: 'cliente@email.com',
            document: '12345678901',
            role: 'CUSTOMER',
          },
        })
      );
    });

    it('deve retornar HTTP 409 quando o email ou documento já existir', async () => {
      (mockedPrisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'existing-id' })
        .mockResolvedValueOnce(null);

      const response = await request(app).post('/api/users').send({
        name: 'Duplicado',
        email: 'duplicado@email.com',
        document: '123.456.789-01',
        role: 'SELLER',
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('deve retornar HTTP 400 (ZodError) quando o documento for inválido', async () => {
      const response = await request(app).post('/api/users').send({
        name: 'Invalido',
        email: 'invalido@email.com',
        document: '12345',
        role: 'SELLER',
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/users', () => {
    it('deve listar usuários filtrando opcionalmente por role', async () => {
      (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Seller 1',
          email: 'seller1@email.com',
          document: '12345678000199',
          role: UserRole.SELLER,
          wallet: {
            id: '660e8400-e29b-41d4-a716-446655440001',
            balanceCents: 15000,
            currency: 'BRL',
            version: 2,
          },
        },
      ]);

      const response = await request(app).get('/api/users?role=SELLER');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].wallet.balanceCents).toBe(15000);
      expect(mockedPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: 'SELLER' },
        })
      );
    });
  });

  describe('GET /api/wallets/:walletId/statement', () => {
    it('deve retornar HTTP 400 se walletId não for um UUID válido', async () => {
      const response = await request(app).get('/api/wallets/id-invalido/statement');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('deve retornar dados da carteira e extrato paginado ordenado por createdAt DESC', async () => {
      const walletId = '660e8400-e29b-41d4-a716-446655440001';

      (mockedPrisma.$transaction as jest.Mock).mockResolvedValue([
        {
          id: walletId,
          userId: '550e8400-e29b-41d4-a716-446655440000',
          balanceCents: 8500,
          currency: 'BRL',
          version: 2,
          createdAt: new Date('2026-11-17T18:00:00.000Z'),
          updatedAt: new Date('2026-11-17T18:10:00.000Z'),
          user: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'Seller 1',
            email: 'seller1@email.com',
            document: '12345678000199',
            role: UserRole.SELLER,
          },
        },
        [
          {
            id: '770e8400-e29b-41d4-a716-446655440099',
            walletId,
            orderId: '880e8400-e29b-41d4-a716-446655440088',
            paymentSplitId: '990e8400-e29b-41d4-a716-446655440077',
            type: LedgerEntryType.CREDIT,
            referenceType: LedgerReferenceType.ORDER_SPLIT,
            amountCents: 8500,
            balanceAfterCents: 8500,
            idempotencyKey: 'idem-key-1',
            description: 'Repasse de venda #1',
            metadata: null,
            createdAt: new Date('2026-11-17T18:10:00.000Z'),
          },
        ],
        1,
      ]);

      const response = await request(app).get(
        `/api/wallets/${walletId}/statement?page=1&limit=10`
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(walletId);
      expect(response.body.balanceCents).toBe(8500);
      expect(response.body.ledgerEntries).toHaveLength(1);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });
  });
});

