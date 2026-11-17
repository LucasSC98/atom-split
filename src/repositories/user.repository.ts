import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/database';
import { CreateUserInput } from '../schemas/user.schema';

export const userWithWalletSelect = {
  id: true,
  name: true,
  email: true,
  document: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  wallet: {
    select: {
      id: true,
      balanceCents: true,
      currency: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

export type UserWithWalletSummary = Prisma.UserGetPayload<{
  select: typeof userWithWalletSelect;
}>;

export class UserRepository {
  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  async findByDocument(document: string) {
    return prisma.user.findUnique({
      where: { document },
    });
  }

  async createWithOptionalWallet(
    data: CreateUserInput,
    shouldCreateWallet: boolean
  ): Promise<UserWithWalletSummary> {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          document: data.document,
          role: data.role,
          ...(shouldCreateWallet
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
        select: userWithWalletSelect,
      });

      return user;
    });
  }

  async findAll(role?: UserRole): Promise<UserWithWalletSummary[]> {
    return prisma.user.findMany({
      where: role ? { role } : undefined,
      select: userWithWalletSelect,
      orderBy: { createdAt: 'desc' },
    });
  }
}

