import { z } from 'zod';

export const walletStatementParamsSchema = z.object({
  walletId: z.string().uuid('O parâmetro walletId deve ser um UUID válido.'),
});

export const walletStatementQuerySchema = z.object({
  page: z.coerce
    .number()
    .int('A página deve ser um número inteiro.')
    .min(1, 'A página mínima é 1.')
    .default(1),
  limit: z.coerce
    .number()
    .int('O limite deve ser um número inteiro.')
    .min(1, 'O limite mínimo é 1.')
    .max(100, 'O limite máximo por página é 100.')
    .default(20),
});

export type WalletStatementParams = z.infer<typeof walletStatementParamsSchema>;
export type WalletStatementQuery = z.infer<typeof walletStatementQuerySchema>;

