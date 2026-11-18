import {
  CheckoutPayload,
  OrderDetails,
  UserWithWallet,
  WalletStatementResponse,
} from '../types/api';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface ApiActionResult<T> {
  ok: boolean;
  status: number;
  idempotentReplayedHeader: string | null;
  data?: T;
  error?: {
    code: string;
    message: string;
    issues?: Array<{ path: string; message: string }>;
  };
}

export async function fetchUsers(): Promise<UserWithWallet[]> {
  const res = await fetch(`${API_BASE_URL}/users`);
  if (res.status === 429) {
    throw new Error('Muitas requisições, aguarde um instante.');
  }
  if (!res.ok) {
    throw new Error('Falha ao carregar usuários e carteiras.');
  }
  return res.json();
}

export async function fetchOrders(): Promise<OrderDetails[]> {
  const res = await fetch(`${API_BASE_URL}/orders`);
  if (res.status === 429) {
    throw new Error('Muitas requisições, aguarde um instante.');
  }
  if (!res.ok) {
    throw new Error('Falha ao carregar histórico de pedidos.');
  }
  return res.json();
}

export async function fetchWalletStatement(
  walletId: string,
  page = 1,
  limit = 50
): Promise<WalletStatementResponse> {
  const res = await fetch(
    `${API_BASE_URL}/wallets/${walletId}/statement?page=${page}&limit=${limit}`
  );
  if (res.status === 429) {
    throw new Error('Muitas requisições, aguarde um instante.');
  }
  if (!res.ok) {
    throw new Error('Falha ao carregar extrato da carteira (Ledger).');
  }
  return res.json();
}

export async function postCheckout(
  idempotencyKey: string,
  payload: CheckoutPayload
): Promise<
  ApiActionResult<{ idempotentReplayed: boolean; order: OrderDetails }>
> {
  const res = await fetch(`${API_BASE_URL}/orders/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const idempotentHeader = res.headers.get('X-Idempotent-Replayed');
  const json = await res.json().catch(() => ({}));

  if (res.status === 429) {
    return {
      ok: false,
      status: 429,
      idempotentReplayedHeader: idempotentHeader,
      error: {
        code: json.code || 'RATE_LIMITED',
        message:
          'Muitas requisições, aguarde um instante antes de tentar novamente.',
      },
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      idempotentReplayedHeader: idempotentHeader,
      error: {
        code: json.code || 'API_ERROR',
        message: json.message || 'Erro ao processar checkout.',
        issues: json.issues,
      },
    };
  }

  return {
    ok: true,
    status: res.status,
    idempotentReplayedHeader: idempotentHeader,
    data: json,
  };
}

export async function postRefundOrder(
  orderId: string
): Promise<
  ApiActionResult<{ idempotentReplayed: boolean; order: OrderDetails }>
> {
  const res = await fetch(`${API_BASE_URL}/orders/${orderId}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const idempotentHeader = res.headers.get('X-Idempotent-Replayed');
  const json = await res.json().catch(() => ({}));

  if (res.status === 429) {
    return {
      ok: false,
      status: 429,
      idempotentReplayedHeader: idempotentHeader,
      error: {
        code: json.code || 'RATE_LIMITED',
        message:
          'Muitas requisições, aguarde um instante antes de tentar novamente.',
      },
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      idempotentReplayedHeader: idempotentHeader,
      error: {
        code: json.code || 'API_ERROR',
        message: json.message || 'Erro ao processar estorno.',
      },
    };
  }

  return {
    ok: true,
    status: res.status,
    idempotentReplayedHeader: idempotentHeader,
    data: json,
  };
}
