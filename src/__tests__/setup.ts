import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Carrega obrigatoriamente o .env.test sobrescrevendo qualquer variável do ambiente de dev
dotenv.config({
  path: path.resolve(process.cwd(), '.env.test'),
  override: true,
});

process.env.NODE_ENV = 'test';

export function assertTestDatabaseGuard(): string {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error(
      '[TEST_DB_GUARD] DATABASE_URL não está definida no ambiente de testes (.env.test).'
    );
  }

  let dbName = '';
  try {
    const parsed = new URL(dbUrl);
    dbName = parsed.pathname.replace(/^\//, '');
  } catch {
    throw new Error(
      `[TEST_DB_GUARD] DATABASE_URL inválida no ambiente de testes: "${dbUrl}".`
    );
  }

  if (!dbName.endsWith('_test')) {
    throw new Error(
      `[TEST_DB_GUARD] Execução abortada! O banco da DATABASE_URL ("${dbName}") DEVE terminar obrigatoriamente em "_test" para proteger o banco de desenvolvimento/produção.`
    );
  }

  return dbName;
}

// Executa o guard imediatamente ao carregar a suíte do Jest
assertTestDatabaseGuard();

/**
 * Executa TRUNCATE nas tabelas do banco exclusivamente após validar o guard `_test`.
 * Nenhum TRUNCATE é permitido fora desta função.
 */
export async function truncateTestDatabaseTables(
  prisma: PrismaClient
): Promise<void> {
  assertTestDatabaseGuard();

  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ledger_entries", "payment_splits", "orders", "wallets", "users" RESTART IDENTITY CASCADE;'
  );
}
