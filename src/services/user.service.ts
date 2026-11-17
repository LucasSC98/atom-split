import { Prisma, UserRole } from '@prisma/client';
import { AppError } from '../errors/AppError';
import { UserRepository, UserWithWalletSummary } from '../repositories/user.repository';
import { CreateUserInput } from '../schemas/user.schema';

export class UserService {
  constructor(private readonly userRepository = new UserRepository()) {}

  async createUser(data: CreateUserInput): Promise<UserWithWalletSummary> {
    const [existingEmail, existingDocument] = await Promise.all([
      this.userRepository.findByEmail(data.email),
      this.userRepository.findByDocument(data.document),
    ]);

    if (existingEmail) {
      throw new AppError(
        'Já existe um usuário cadastrado com este e-mail.',
        409,
        'EMAIL_ALREADY_EXISTS'
      );
    }

    if (existingDocument) {
      throw new AppError(
        'Já existe um usuário cadastrado com este documento (CPF/CNPJ).',
        409,
        'DOCUMENT_ALREADY_EXISTS'
      );
    }

    // Regra de Negócio: SELLER e PLATFORM exigem criação atômica de Wallet;
    // CUSTOMER não possui Wallet obrigatória.
    const shouldCreateWallet =
      data.role === UserRole.SELLER || data.role === UserRole.PLATFORM;

    try {
      return await this.userRepository.createWithOptionalWallet(
        data,
        shouldCreateWallet
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'Conflito de dados: e-mail ou documento já cadastrado.',
          409,
          'USER_CONFLICT'
        );
      }
      throw error;
    }
  }

  async listUsers(role?: UserRole): Promise<UserWithWalletSummary[]> {
    return this.userRepository.findAll(role);
  }
}

