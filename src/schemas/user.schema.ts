import { z } from 'zod';
import { UserRole } from '@prisma/client';

export const createUserSchema = z.object({
  name: z
    .string({ required_error: 'O nome é obrigatório.' })
    .trim()
    .min(2, 'O nome deve ter pelo menos 2 caracteres.')
    .max(120, 'O nome deve ter no máximo 120 caracteres.'),
  email: z
    .string({ required_error: 'O e-mail é obrigatório.' })
    .trim()
    .toLowerCase()
    .email('Formato de e-mail inválido.'),
  document: z
    .string({ required_error: 'O documento (CPF/CNPJ) é obrigatório.' })
    .transform((val) => val.replace(/\D/g, ''))
    .refine((val) => val.length === 11 || val.length === 14, {
      message: 'O documento deve conter 11 dígitos (CPF) ou 14 dígitos (CNPJ).',
    }),
  role: z.nativeEnum(UserRole, {
    errorMap: () => ({
      message: 'O campo role deve ser PLATFORM, SELLER ou CUSTOMER.',
    }),
  }),
});

export const listUsersQuerySchema = z.object({
  role: z
    .nativeEnum(UserRole, {
      errorMap: () => ({
        message: 'O filtro role deve ser PLATFORM, SELLER ou CUSTOMER.',
      }),
    })
    .optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

