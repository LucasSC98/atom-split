import request from 'supertest';
import { OrderStatus, UserRole } from '@prisma/client';
import { app } from '../app';
import { prisma } from '../config/database';

describe('Tarefa 8: Suíte E2E de Concorrência, Idempotência Estrita, Trigger Imutável e Invariantes', () => {
  let platformId: string;
  let platformWalletId: string;
  let sellerAId: string;
  let sellerAWalletId: string;
  let sellerBId: string;
  let sellerBWalletId: string;
  let customerId: string;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ledger_entries", "payment_splits", "orders", "wallets", "users" RESTART IDENTITY CASCADE;'
    );

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
      name: 'Cliente Concorrência',
      email: 'cliente.concorrencia@email.com',
      document: '123.456.789-09',
      role: UserRole.CUSTOMER,
    });
    customerId = customerRes.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function buildValidPayload(totalAmountCents = 10000) {
    const platformFee = Math.round(totalAmountCents * 0.15);
    const sellerAShare = Math.round(totalAmountCents * 0.5);
    const sellerBShare = totalAmountCents - platformFee - sellerAShare;

    return {
      customerId,
      totalAmountCents,
      description: 'Compra Concorrente E2E',
      splits: [
        {
          recipientId: platformId,
          splitType: 'PLATFORM_FEE',
          amountCents: platformFee,
          feeBps: 1500,
        },
        {
          recipientId: sellerAId,
          splitType: 'SELLER_SHARE',
          amountCents: sellerAShare,
        },
        {
          recipientId: sellerBId,
          splitType: 'SELLER_SHARE',
          amountCents: sellerBShare,
        },
      ],
    };
  }

  it('1. 10 checkouts paralelos com chaves diferentes -> todos 201, saldos finais corretos, nenhum 500', async () => {
    const parallelCount = 10;
    const payload = buildValidPayload(10000);

    const requests = Array.from({ length: parallelCount }, (_, idx) =>
      request(app)
        .post('/api/orders/checkout')
        .set('Idempotency-Key', `parallel-checkout-key-${idx + 1}`)
        .send(payload)
    );

    const responses = await Promise.all(requests);

    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);
    expect(statuses.some((s) => s >= 500)).toBe(false);

    const [platformWallet, sellerAWallet, sellerBWallet] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: platformWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerAWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerBWalletId } }),
    ]);

    expect(platformWallet.balanceCents).toBe(1500 * parallelCount);
    expect(sellerAWallet.balanceCents).toBe(5000 * parallelCount);
    expect(sellerBWallet.balanceCents).toBe(3500 * parallelCount);
  }, 20000);

  it('2. 2 checkouts paralelos com a MESMA chave -> um 201 e um 200 (replayed), saldo creditado uma única vez', async () => {
    const [beforePlatform, beforeSellerA, beforeSellerB] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: platformWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerAWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerBWalletId } }),
    ]);

    const payload = buildValidPayload(10000);
    const sameKey = 'parallel-same-idempotency-key-001';

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/orders/checkout')
        .set('Idempotency-Key', sameKey)
        .send(payload),
      request(app)
        .post('/api/orders/checkout')
        .set('Idempotency-Key', sameKey)
        .send(payload),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 201]);

    const replayedFlags = [
      res1.body.idempotentReplayed,
      res2.body.idempotentReplayed,
    ].sort();
    expect(replayedFlags).toEqual([false, true]);
    expect(res1.body.order.id).toBe(res2.body.order.id);

    const [afterPlatform, afterSellerA, afterSellerB] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: platformWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerAWalletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: sellerBWalletId } }),
    ]);

    // Garante que creditou apenas 1 vez (e não 2x)
    expect(afterPlatform.balanceCents).toBe(beforePlatform.balanceCents + 1500);
    expect(afterSellerA.balanceCents).toBe(beforeSellerA.balanceCents + 5000);
    expect(afterSellerB.balanceCents).toBe(beforeSellerB.balanceCents + 3500);
  });

  it('3. 2 refunds paralelos do mesmo pedido -> um estorno efetivo, o outro replay 200, saldos decrementados uma única vez', async () => {
    const payload = buildValidPayload(20000);
    const checkoutRes = await request(app)
      .post('/api/orders/checkout')
      .set('Idempotency-Key', 'order-to-parallel-refund-001')
      .send(payload);

    expect(checkoutRes.status).toBe(201);
    const orderId = checkoutRes.body.order.id;

    const [beforeRefundPlatform, beforeRefundSellerA, beforeRefundSellerB] =
      await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { id: platformWalletId } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: sellerAWalletId } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: sellerBWalletId } }),
      ]);

    const [refundRes1, refundRes2] = await Promise.all([
      request(app).post(`/api/orders/${orderId}/refund`),
      request(app).post(`/api/orders/${orderId}/refund`),
    ]);

    expect(refundRes1.status).toBe(200);
    expect(refundRes2.status).toBe(200);

    const replayFlags = [
      refundRes1.body.idempotentReplayed,
      refundRes2.body.idempotentReplayed,
    ].sort();
    expect(replayFlags).toEqual([false, true]);

    const [afterRefundPlatform, afterRefundSellerA, afterRefundSellerB] =
      await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { id: platformWalletId } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: sellerAWalletId } }),
        prisma.wallet.findUniqueOrThrow({ where: { id: sellerBWalletId } }),
      ]);

    expect(afterRefundPlatform.balanceCents).toBe(
      beforeRefundPlatform.balanceCents - 3000
    );
    expect(afterRefundSellerA.balanceCents).toBe(
      beforeRefundSellerA.balanceCents - 10000
    );
    expect(afterRefundSellerB.balanceCents).toBe(
      beforeRefundSellerB.balanceCents - 7000
    );
  });

  it('4. Mesma chave com payload diferente -> deve bloquear com HTTP 422 (IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD)', async () => {
    const differentPayload = buildValidPayload(50000); // Era 10000 na chave parallel-same-idempotency-key-001

    const res = await request(app)
      .post('/api/orders/checkout')
      .set('Idempotency-Key', 'parallel-same-idempotency-key-001')
      .send(differentPayload);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  });

  it('5. Invariante Contábil Global: soma de todas as wallets === soma de totalAmountCents dos pedidos PAID (excluindo REFUNDED)', async () => {
    const [wallets, paidOrders] = await Promise.all([
      prisma.wallet.findMany(),
      prisma.order.findMany({
        where: { status: OrderStatus.PAID },
      }),
    ]);

    const totalWalletsBalanceCents = wallets.reduce(
      (acc, w) => acc + w.balanceCents,
      0
    );
    const totalPaidOrdersCents = paidOrders.reduce(
      (acc, o) => acc + o.totalAmountCents,
      0
    );

    expect(totalWalletsBalanceCents).toBeGreaterThan(0);
    expect(totalWalletsBalanceCents).toBe(totalPaidOrdersCents);
  });

  it('6. Imutabilidade no Banco: tentativa de UPDATE ou DELETE direto em ledger_entries via SQL deve falhar pelo trigger append-only', async () => {
    const anyEntry = await prisma.ledgerEntry.findFirstOrThrow();

    await expect(
      prisma.$executeRaw`UPDATE "ledger_entries" SET "amount_cents" = 999999 WHERE "id" = ${anyEntry.id}::uuid`
    ).rejects.toThrow(/ledger é append-only/i);

    await expect(
      prisma.$executeRaw`DELETE FROM "ledger_entries" WHERE "id" = ${anyEntry.id}::uuid`
    ).rejects.toThrow(/ledger é append-only/i);
  });
});
