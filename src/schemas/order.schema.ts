import { z } from 'zod';
import { SplitType } from '@prisma/client';

export const checkoutHeadersSchema = z.object({
  'idempotency-key': z
    .string({
      required_error: 'O header Idempotency-Key é obrigatório.',
      invalid_type_error: 'O header Idempotency-Key deve ser uma string.',
    })
    .trim()
    .min(1, 'O header Idempotency-Key não pode ser vazio.')
    .max(255, 'O header Idempotency-Key deve ter no máximo 255 caracteres.'),
});

export const splitItemSchema = z.object({
  recipientId: z
    .string({ required_error: 'O campo recipientId é obrigatório.' })
    .uuid('O campo recipientId deve ser um UUID válido.'),
  splitType: z.nativeEnum(SplitType, {
    errorMap: () => ({
      message: 'O campo splitType deve ser PLATFORM_FEE ou SELLER_SHARE.',
    }),
  }),
  amountCents: z
    .number({
      required_error: 'O campo amountCents do split é obrigatório.',
      invalid_type_error: 'O campo amountCents deve ser um número inteiro em centavos.',
    })
    .int('O campo amountCents deve ser um número inteiro (centavos).')
    .positive('O campo amountCents deve ser maior que zero.')
    .max(
      2_000_000_000,
      'O campo amountCents excede o limite máximo seguro de inteiro de 32 bits (2.000.000.000 centavos).'
    ),
  feeBps: z
    .number({
      invalid_type_error: 'O campo feeBps deve ser um número inteiro (basis points).',
    })
    .int('O campo feeBps deve ser um número inteiro.')
    .min(0, 'O campo feeBps não pode ser negativo.')
    .max(10000, 'O campo feeBps não pode exceder 10000 (100%).')
    .optional(),
});

export const createCheckoutSchema = z.object({
  customerId: z
    .string({ required_error: 'O campo customerId é obrigatório.' })
    .uuid('O campo customerId deve ser um UUID válido.'),
  totalAmountCents: z
    .number({
      required_error: 'O campo totalAmountCents é obrigatório.',
      invalid_type_error: 'O campo totalAmountCents deve ser um número inteiro em centavos.',
    })
    .int('O campo totalAmountCents deve ser um número inteiro (centavos).')
    .positive('O campo totalAmountCents deve ser maior que zero.')
    .max(
      2_000_000_000,
      'O campo totalAmountCents excede o limite máximo seguro de inteiro de 32 bits (2.000.000.000 centavos).'
    ),
  description: z
    .string()
    .trim()
    .max(255, 'A descrição deve ter no máximo 255 caracteres.')
    .optional(),
  splits: z
    .array(splitItemSchema, {
      required_error: 'O array de splits é obrigatório.',
    })
    .min(1, 'O pedido deve conter pelo menos 1 item de split.'),
});

export const orderParamsSchema = z.object({
  orderId: z.string().uuid('O parâmetro orderId deve ser um UUID válido.'),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type SplitItemInput = z.infer<typeof splitItemSchema>;
export type OrderParams = z.infer<typeof orderParamsSchema>;

