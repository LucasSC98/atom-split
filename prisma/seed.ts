import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedActorInput {
  name: string;
  email: string;
  document: string;
  role: UserRole;
  hasWallet: boolean;
}

const seedActors: SeedActorInput[] = [
  {
    name: 'AtomicSplit Marketplace',
    email: 'platform@atomicsplit.com.br',
    document: '00000000000191',
    role: UserRole.PLATFORM,
    hasWallet: true,
  },
  {
    name: 'Tech Store Brasil',
    email: 'contato@techstorebrasil.com.br',
    document: '11111111000191',
    role: UserRole.SELLER,
    hasWallet: true,
  },
  {
    name: 'Livraria Dev',
    email: 'contato@livrariadev.com.br',
    document: '22222222000191',
    role: UserRole.SELLER,
    hasWallet: true,
  },
  {
    name: 'Cliente Teste',
    email: 'cliente.teste@email.com',
    document: '12345678909',
    role: UserRole.CUSTOMER,
    hasWallet: false,
  },
];

async function main() {
  console.log('🌱 Iniciando seed idempotente do banco de dados...\n');

  const results: Array<{
    name: string;
    role: UserRole;
    userId: string;
    walletId: string;
  }> = [];

  for (const actor of seedActors) {
    const user = await prisma.user.upsert({
      where: { document: actor.document },
      update: {
        name: actor.name,
        email: actor.email,
        role: actor.role,
        ...(actor.hasWallet
          ? {
              wallet: {
                upsert: {
                  create: {
                    balanceCents: 0,
                    currency: 'BRL',
                    version: 1,
                  },
                  update: {},
                },
              },
            }
          : {}),
      },
      create: {
        name: actor.name,
        email: actor.email,
        document: actor.document,
        role: actor.role,
        ...(actor.hasWallet
          ? {
              wallet: {
                create: {
                  balanceCents: 0,
                  currency: 'BRL',
                  version: 1,
                },
              },
            }
          : {}),
      },
      include: {
        wallet: true,
      },
    });

    results.push({
      name: user.name,
      role: user.role,
      userId: user.id,
      walletId: user.wallet?.id ?? 'N/A (CUSTOMER)',
    });
  }

  console.log('✅ Seed concluído com sucesso! Atores disponíveis para checkout:');
  console.table(results);
}

main()
  .catch((error) => {
    console.error('❌ Erro ao executar seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

