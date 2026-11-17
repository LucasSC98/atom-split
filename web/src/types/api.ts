export type UserRole = 'PLATFORM' | 'SELLER' | 'CUSTOMER';
export type OrderStatus = 'PENDING' | 'PAID' | 'REFUNDED' | 'FAILED';
export type SplitType = 'PLATFORM_FEE' | 'SELLER_SHARE';
export type LedgerEntryType = 'CREDIT' | 'DEBIT';
export type LedgerReferenceType =
  | 'ORDER_SPLIT'
  | 'ORDER_REFUND'
  | 'WITHDRAWAL'
  | 'TRANSFER';

export interface WalletSummary {
  id: string;
  balanceCents: number;
  currency: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserWithWallet {
  id: string;
  name: string;
  email: string;
  document: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  wallet: WalletSummary | null;
}

export interface PaymentSplitItem {
  id: string;
  orderId: string;
  recipientId: string;
  walletId: string;
  splitType: SplitType;
  amountCents: number;
  feeBps: number | null;
  createdAt: string;
  recipient: {
    id: string;
    name: string;
    role: UserRole;
  };
}

export interface LedgerEntryItem {
  id: string;
  walletId: string;
  orderId: string | null;
  paymentSplitId: string | null;
  type: LedgerEntryType;
  referenceType: LedgerReferenceType;
  amountCents: number;
  balanceAfterCents: number;
  idempotencyKey: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface OrderDetails {
  id: string;
  customerId: string;
  idempotencyKey: string;
  totalAmountCents: number;
  currency: string;
  status: OrderStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    name: string;
    email: string;
    document: string;
    role: UserRole;
  };
  paymentSplits: PaymentSplitItem[];
  ledgerEntries: LedgerEntryItem[];
}

export interface WalletStatementResponse {
  id: string;
  userId: string;
  balanceCents: number;
  currency: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    document: string;
    role: UserRole;
  };
  ledgerEntries: LedgerEntryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CheckoutPayload {
  customerId: string;
  totalAmountCents: number;
  description?: string;
  splits: Array<{
    recipientId: string;
    splitType: SplitType;
    amountCents: number;
    feeBps?: number;
  }>;
}

