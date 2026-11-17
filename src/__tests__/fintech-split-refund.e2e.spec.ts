import request from 'supertest';
import {
  LedgerEntryType,
  LedgerReferenceType,
  OrderStatus,
  UserRole,
} from '@prisma/client';
import { app } from '../app';
import { prisma } from '../config/database';

describe('Etapa 4: Suíte E2E de Split de Pagamentos, Idempotência, Zero-Sum e Estorno (Refund)', () => {
  let platformId: string;
  let platformWalletId: string;
  let sellerAId: string;
  let sellerAWalletId: string;
  let sellerBId: string;
  let sellerBWalletId: string;
  let customerId: string;
  let createdOrderId: string;

  beforeAll(async () => {
    // Limpa tabelas na ordem correta (respeitando onDelete: Restrict) e cria atores limpos para o teste E2E
    await prisma.ledgerEntry.deleteMany({});
    await prisma.paymentSplit.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.user.deleteMany({});

    // Cria Plataforma, 2 Vendedores e 1 Cliente via API POST /api/users
    const platformRes = await request(app).post('/api/users').send({
      name: 'AtomicSplit Marketplace',
      email: 'platform@atomicsplit.com.br',
      document: '00.000.000/0001-91',
      role: UserRole.PLATFORM,
    });
    platformId = platformRes.body.id;
    platformWalletId = platformRes.body.wallet.id;

    const sellerARes = await request(app).post('/api/users').send({
      name: 'Tech Store Brasil',
      email: 'contato@techstorebrasil.com.br',
      document: '11.111.111/0001-91',
      role: UserRole.SELLER,
    });
    sellerAId = sellerARes.body.id;
    sellerAWalletId = sellerARes.body.wallet.id;

    const sellerBRes = await request(app).post('/api/users').send({
      name: 'Livraria Dev',
      email: 'contato@livrariadev.com.br',
      document: '22.222.222/0001-91',
      role: UserRole.SELLER,
    });
    sellerBId = sellerBRes.body.id;
    sellerBWalletId = sellerBRes.body.wallet.id;

    const customerRes = await request(app).post('/api/users').send({
      name: 'Cliente Teste',
      email: 'cliente.teste@email.com',
      document: '123.456.789-09',
      role: UserRole.CUSTOMER,
    });
    customerId = customerRes.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('Cenário 1 - Checkout com Split Válido: divide R$ 100,00 (10000 centavos) entre Plataforma e Vendedores, atualiza saldos, incrementa version e gera 3 LedgerEntries CREDIT', async () => {
    const response = await request(app)
      .post('/api/orders/checkout')
      .set('Idempotency-Key', 'e2e-checkout-valid-001')
      .send({
        customerId,
        totalAmountCents: 10000,
        description: 'Pedido #001 - Notebook + Livro Clean Architecture',
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
            amountCents: 3500,
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.idempotentReplayed).toBe(false);
    expect(response.body.order.status).toBe(OrderStatus.PAID);
    expect(response.body.order.totalAmountCents).toBe(10000);
    expect(response.body.order.paymentSplits).toHaveLength(3);
    expect(response.body.order.ledgerEntries).toHaveLength(3);

    createdOrderId = response.body.order.id;

    // Verifica que todos os 3 lançamentos são CREDIT do tipo ORDER_SPLIT
    for (const entry of response.body.order.ledgerEntries) {
      expect(entry.type).toBe(LedgerEntryType.CREDIT);
      expect(entry.referenceType).toBe(LedgerReferenceType.ORDER_SPLIT);
    }

    // Valida saldos e version (deve ter subido de 1 para 2) nas 3 Wallets
    const [platformWallet, sellerAWallet, sellerBWallet] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: platformWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerAWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerBWalletId } }),
    ]);

    expect(platformWallet.balanceCents).toBe(1500);
    expect(platformWallet.version).toBe(2);

    expect(sellerAWallet.balanceCents).toBe(5000);
    expect(sellerAWallet.version).toBe(2);

    expect(sellerBWallet.balanceCents).toBe(3500);
    expect(sellerBWallet.version).toBe(2);
  });

  it('Cenário 2 - Bloqueio de Split Inválido (Zero-Sum): rejeita soma de 9999 centavos para total de 10000 centavos com HTTP 422 e mantém saldos intactos', async () => {
    const response = await request(app)
      .post('/api/orders/checkout')
      .set('Idempotency-Key', 'e2e-checkout-invalid-sum-002')
      .send({
        customerId,
        totalAmountCents: 10000,
        description: 'Pedido Inválido (Diferença de 1 centavo)',
        splits: [
          {
            recipientId: platformId,
            splitType: 'PLATFORM_FEE',
            amountCents: 1500,
          },
          {
            recipientId: sellerAId,
            splitType: 'SELLER_SHARE',
            amountCents: 5000,
          },
          {
            recipientId: sellerBId,
            splitType: 'SELLER_SHARE',
            amountCents: 3499, // Soma = 9999 != 10000
          },
        ],
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_SPLIT_SUM');

    // Garante que os saldos e versões permaneceram inalterados
    const [platformWallet, sellerAWallet, sellerBWallet] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: platformWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerAWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerBWalletId } }),
    ]);

    expect(platformWallet.balanceCents).toBe(1500);
    expect(platformWallet.version).toBe(2);
    expect(sellerAWallet.balanceCents).toBe(5000);
    expect(sellerAWallet.version).toBe(2);
    expect(sellerBWallet.balanceCents).toBe(3500);
    expect(sellerBWallet.version).toBe(2);
  });

  it('Cenário 3 - Garantia de Idempotência: duas requisições com a mesma Idempotency-Key creditam as carteiras apenas uma vez', async () => {
    const duplicateResponse = await request(app)
      .post('/api/orders/checkout')
      .set('Idempotency-Key', 'e2e-checkout-valid-001') // Mesma chave do Cenário 1
      .send({
        customerId,
        totalAmountCents: 10000,
        description: 'Pedido #001 - Notebook + Livro Clean Architecture',
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
            amountCents: 3500,
          },
        ],
      });

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.headers['x-idempotent-replayed']).toBe('true');
    expect(duplicateResponse.body.idempotentReplayed).toBe(true);
    expect(duplicateResponse.body.order.id).toBe(createdOrderId);

    // Saldos e versões NÃO podem ter dobrado
    const [platformWallet, sellerAWallet, sellerBWallet] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: platformWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerAWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerBWalletId } }),
    ]);

    expect(platformWallet.balanceCents).toBe(1500);
    expect(platformWallet.version).toBe(2);
    expect(sellerAWallet.balanceCents).toBe(5000);
    expect(sellerAWallet.version).toBe(2);
    expect(sellerBWallet.balanceCents).toBe(3500);
    expect(sellerBWallet.version).toBe(2);
  });

  it('Cenário 4 - Fluxo de Estorno (Refund): estorna pedido pago, muda status para REFUNDED, zera saldos, sobe version para 3 e preserva histórico imutável (CREDIT + DEBIT)', async () => {
    const refundRes = await request(app).post(
      `/api/orders/${createdOrderId}/refund`
    );

    expect(refundRes.status).toBe(200);
    expect(refundRes.headers['x-idempotent-replayed']).toBe('false');
    expect(refundRes.body.idempotentReplayed).toBe(false);
    expect(refundRes.body.order.status).toBe(OrderStatus.REFUNDED);

    // O pedido agora deve possuir 6 entradas no Ledger: 3 CREDIT originais + 3 DEBIT de estorno
    expect(refundRes.body.order.ledgerEntries).toHaveLength(6);

    const creditEntries = refundRes.body.order.ledgerEntries.filter(
      (e: { type: LedgerEntryType }) => e.type === LedgerEntryType.CREDIT
    );
    const debitEntries = refundRes.body.order.ledgerEntries.filter(
      (e: { type: LedgerEntryType }) => e.type === LedgerEntryType.DEBIT
    );

    expect(creditEntries).toHaveLength(3);
    expect(debitEntries).toHaveLength(3);

    for (const debit of debitEntries) {
      expect(debit.referenceType).toBe(LedgerReferenceType.ORDER_REFUND);
      expect(debit.balanceAfterCents).toBe(0);
      expect(debit.idempotencyKey).toMatch(
        /^e2e-checkout-valid-001:refund:[0-9a-f-]+$/
      );
    }

    // Verifica que os saldos voltaram a 0 e a version subiu de 2 para 3
    const [platformWallet, sellerAWallet, sellerBWallet] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: platformWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerAWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerBWalletId } }),
    ]);

    expect(platformWallet.balanceCents).toBe(0);
    expect(platformWallet.version).toBe(3);

    expect(sellerAWallet.balanceCents).toBe(0);
    expect(sellerAWallet.version).toBe(3);

    expect(sellerBWallet.balanceCents).toBe(0);
    expect(sellerBWallet.version).toBe(3);

    // Verifica no endpoint de extrato (GET /api/wallets/:walletId/statement) que tanto o CREDIT quanto o DEBIT estão preservados
    const statementRes = await request(app).get(
      `/api/wallets/${sellerAWalletId}/statement`
    );

    expect(statementRes.status).toBe(200);
    expect(statementRes.body.balanceCents).toBe(0);
    expect(statementRes.body.version).toBe(3);
    expect(statementRes.body.ledgerEntries).toHaveLength(2);
    expect(statementRes.body.ledgerEntries[0].type).toBe(LedgerEntryType.DEBIT);
    expect(statementRes.body.ledgerEntries[0].amountCents).toBe(5000);
    expect(statementRes.body.ledgerEntries[0].balanceAfterCents).toBe(0);
    expect(statementRes.body.ledgerEntries[1].type).toBe(LedgerEntryType.CREDIT);
    expect(statementRes.body.ledgerEntries[1].amountCents).toBe(5000);
    expect(statementRes.body.ledgerEntries[1].balanceAfterCents).toBe(5000);

    // Testa também a idempotência do estorno (chamar POST /refund novamente num pedido já REFUNDED)
    const secondRefundRes = await request(app).post(
      `/api/orders/${createdOrderId}/refund`
    );

    expect(secondRefundRes.status).toBe(200);
    expect(secondRefundRes.headers['x-idempotent-replayed']).toBe('true');
    expect(secondRefundRes.body.idempotentReplayed).toBe(true);
    expect(secondRefundRes.body.order.status).toBe(OrderStatus.REFUNDED);
    expect(secondRefundRes.body.order.ledgerEntries).toHaveLength(6);
  });
});

