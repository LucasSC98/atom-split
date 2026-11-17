import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Building2,
  CheckCircle2,
  Coins,
  Copy,
  CreditCard,
  History,
  KeyRound,
  Layers,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  UserCheck,
  Wallet,
} from 'lucide-react';
import {
  fetchOrders,
  fetchUsers,
  fetchWalletStatement,
  postCheckout,
  postRefundOrder,
} from './services/api';
import {
  OrderDetails,
  SplitType,
  UserWithWallet,
  WalletStatementResponse,
} from './types/api';

function formatBRLFromCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

interface TelemetryBanner {
  type: 'success' | 'idempotent' | 'error';
  title: string;
  httpStatus: number;
  code: string;
  message: string;
  idempotencyKey?: string;
  replayedHeader?: string | null;
  timestamp: string;
}

interface EditableSplitRow {
  recipientId: string;
  recipientName: string;
  role: 'PLATFORM' | 'SELLER';
  splitType: SplitType;
  amountCents: number;
  feeBps?: number;
}

export default function App() {
  const [users, setUsers] = useState<UserWithWallet[]>([]);
  const [orders, setOrders] = useState<OrderDetails[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [statement, setStatement] = useState<WalletStatementResponse | null>(
    null
  );
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Estado do Simulador de Checkout
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [totalAmountCents, setTotalAmountCents] = useState<number>(10000);
  const [description, setDescription] = useState<string>(
    'Compra Marketplace — Split Transacional ACID'
  );
  const [splitRows, setSplitRows] = useState<EditableSplitRow[]>([]);
  const [lastUsedIdempotencyKey, setLastUsedIdempotencyKey] =
    useState<string>('');
  const [telemetry, setTelemetry] = useState<TelemetryBanner | null>(null);

  // Participantes com carteira (PLATFORM Primeiro, depois SELLERs)
  const walletParticipants = useMemo(() => {
    return users
      .filter((u) => u.wallet !== null)
      .sort((a, b) => {
        if (a.role === 'PLATFORM' && b.role !== 'PLATFORM') return -1;
        if (a.role !== 'PLATFORM' && b.role === 'PLATFORM') return 1;
        return a.name.localeCompare(b.name);
      });
  }, [users]);

  const customers = useMemo(() => {
    return users.filter((u) => u.role === 'CUSTOMER');
  }, [users]);

  // Carrega usuários, pedidos e extrato da carteira selecionada
  const refreshAllData = useCallback(
    async (walletIdToLoad?: string | null) => {
      try {
        const [usersData, ordersData] = await Promise.all([
          fetchUsers(),
          fetchOrders(),
        ]);
        setUsers(usersData);
        setOrders(ordersData);

        const targetWalletId =
          walletIdToLoad ??
          selectedWalletId ??
          usersData.find((u) => u.role === 'PLATFORM' && u.wallet)?.wallet?.id ??
          usersData.find((u) => u.wallet)?.wallet?.id ??
          null;

        if (targetWalletId) {
          setSelectedWalletId(targetWalletId);
          const stmt = await fetchWalletStatement(targetWalletId);
          setStatement(stmt);
        }
      } catch (err) {
        console.error('Erro ao atualizar dados do console:', err);
      } finally {
        setLoadingInitial(false);
      }
    },
    [selectedWalletId]
  );

  useEffect(() => {
    refreshAllData();
  }, []);

  // Inicializa o cliente comprador e as linhas de split padrão quando os usuários carregarem pela primeira vez
  useEffect(() => {
    if (customers.length > 0 && !selectedCustomerId) {
      setSelectedCustomerId(customers[0].id);
    }

    if (walletParticipants.length > 0 && splitRows.length === 0) {
      applyStandardSplitCalculation(10000, walletParticipants);
    }
  }, [customers, walletParticipants, selectedCustomerId, splitRows.length]);

  // Recarrega extrato ao trocar de carteira selecionada nos cards do topo
  const handleSelectWallet = async (walletId: string) => {
    setSelectedWalletId(walletId);
    try {
      const stmt = await fetchWalletStatement(walletId);
      setStatement(stmt);
    } catch (err) {
      console.error(err);
    }
  };

  // Auto-Calcula Split Padrão (15% Plataforma / 50% Loja A / 35% Loja B) garantindo Zero-Sum exato em centavos
  const applyStandardSplitCalculation = (
    baseTotalCents: number,
    participants = walletParticipants
  ) => {
    const platform = participants.find((p) => p.role === 'PLATFORM');
    const sellers = participants.filter((p) => p.role === 'SELLER');

    const newRows: EditableSplitRow[] = [];

    const platformShare = Math.round(baseTotalCents * 0.15);
    const sellerAShare = Math.round(baseTotalCents * 0.5);
    const sellerBShare = baseTotalCents - platformShare - sellerAShare;

    if (platform) {
      newRows.push({
        recipientId: platform.id,
        recipientName: platform.name,
        role: 'PLATFORM',
        splitType: 'PLATFORM_FEE',
        amountCents: platformShare,
        feeBps: 1500,
      });
    }

    if (sellers[0]) {
      newRows.push({
        recipientId: sellers[0].id,
        recipientName: sellers[0].name,
        role: 'SELLER',
        splitType: 'SELLER_SHARE',
        amountCents: sellerAShare,
      });
    }

    if (sellers[1]) {
      newRows.push({
        recipientId: sellers[1].id,
        recipientName: sellers[1].name,
        role: 'SELLER',
        splitType: 'SELLER_SHARE',
        amountCents: sellerBShare,
      });
    } else if (sellers[0] && newRows.length === 2) {
      newRows[1].amountCents += sellerBShare;
    }

    setSplitRows(newRows);
  };

  const handleUpdateSplitCents = (index: number, newCents: number) => {
    setSplitRows((prev) =>
      prev.map((row, idx) =>
        idx === index
          ? { ...row, amountCents: Number.isNaN(newCents) ? 0 : Math.max(0, Math.trunc(newCents)) }
          : row
      )
    );
  };

  const currentSplitsSumCents = useMemo(() => {
    return splitRows.reduce((acc, r) => acc + r.amountCents, 0);
  }, [splitRows]);

  const diffCents = totalAmountCents - currentSplitsSumCents;

  // BOTÃO 1 (Verde): Processar Checkout com Nova Idempotency-Key
  const handleCheckoutNewKey = async () => {
    if (!selectedCustomerId) return;
    setActionLoading(true);

    const newKey = `idem-${crypto.randomUUID()}`;
    setLastUsedIdempotencyKey(newKey);

    try {
      const result = await postCheckout(newKey, {
        customerId: selectedCustomerId,
        totalAmountCents,
        description,
        splits: splitRows.map((s) => ({
          recipientId: s.recipientId,
          splitType: s.splitType,
          amountCents: s.amountCents,
          ...(s.feeBps !== undefined ? { feeBps: s.feeBps } : {}),
        })),
      });

      if (result.ok && result.data) {
        setTelemetry({
          type: result.data.idempotentReplayed ? 'idempotent' : 'success',
          title: 'Checkout Liquidado Atomicame no Ledger ($transaction)',
          httpStatus: result.status,
          code: 'ORDER_PAID_AND_SPLIT',
          message: `Pedido ${result.data.order.id.slice(0, 8)}... criado com ${result.data.order.paymentSplits.length} splits e ${result.data.order.ledgerEntries.length} lançamentos CREDIT imutáveis.`,
          idempotencyKey: newKey,
          replayedHeader: result.idempotentReplayedHeader,
          timestamp: new Date().toLocaleTimeString('pt-BR'),
        });
        await refreshAllData();
      } else if (result.error) {
        setTelemetry({
          type: 'error',
          title: 'Checkout Rejeitado pela Regra Financeira',
          httpStatus: result.status,
          code: result.error.code,
          message: result.error.message,
          idempotencyKey: newKey,
          replayedHeader: result.idempotentReplayedHeader,
          timestamp: new Date().toLocaleTimeString('pt-BR'),
        });
      }
    } finally {
      setActionLoading(false);
    }
  };

  // BOTÃO 2 (Amarelo): Repetir Última Chave (Testar Idempotência)
  const handleReplayLastIdempotencyKey = async () => {
    if (!selectedCustomerId) return;
    const keyToReplay =
      lastUsedIdempotencyKey ||
      orders[0]?.idempotencyKey ||
      `idem-${crypto.randomUUID()}`;

    setLastUsedIdempotencyKey(keyToReplay);
    setActionLoading(true);

    try {
      const result = await postCheckout(keyToReplay, {
        customerId: selectedCustomerId,
        totalAmountCents,
        description,
        splits: splitRows.map((s) => ({
          recipientId: s.recipientId,
          splitType: s.splitType,
          amountCents: s.amountCents,
          ...(s.feeBps !== undefined ? { feeBps: s.feeBps } : {}),
        })),
      });

      if (result.ok && result.data) {
        setTelemetry({
          type: 'idempotent',
          title: ' Barreira de Idempotência Ativada — Cobrança Duplicada Bloqueada!',
          httpStatus: result.status,
          code: 'IDEMPOTENT_REPLAY_PROTECTED',
          message: `O backend reconheceu a chave "${keyToReplay}", respondeu HTTP ${result.status} com header X-Idempotent-Replayed: ${result.idempotentReplayedHeader} e NÃO creditou as carteiras uma segunda vez.`,
          idempotencyKey: keyToReplay,
          replayedHeader: result.idempotentReplayedHeader,
          timestamp: new Date().toLocaleTimeString('pt-BR'),
        });
        await refreshAllData();
      } else if (result.error) {
        setTelemetry({
          type: 'error',
          title: 'Erro ao testar replay idempotente',
          httpStatus: result.status,
          code: result.error.code,
          message: result.error.message,
          idempotencyKey: keyToReplay,
          timestamp: new Date().toLocaleTimeString('pt-BR'),
        });
      }
    } finally {
      setActionLoading(false);
    }
  };

  // BOTÃO 3 (Vermelho): Forçar Erro de 1 Centavo (Testar Zero-Sum HTTP 422)
  const handleForceZeroSumError = async () => {
    if (!selectedCustomerId || splitRows.length === 0) return;
    setActionLoading(true);

    const brokenKey = `idem-zerosum-fail-${crypto.randomUUID().slice(0, 8)}`;

    // Subtrai 1 centavo do último split em relação ao totalAmountCents
    const corruptedSplits = splitRows.map((s, idx) => {
      if (idx === splitRows.length - 1) {
        return {
          recipientId: s.recipientId,
          splitType: s.splitType,
          amountCents: Math.max(1, s.amountCents - 1),
          ...(s.feeBps !== undefined ? { feeBps: s.feeBps } : {}),
        };
      }
      return {
        recipientId: s.recipientId,
        splitType: s.splitType,
        amountCents: s.amountCents,
        ...(s.feeBps !== undefined ? { feeBps: s.feeBps } : {}),
      };
    });

    try {
      const result = await postCheckout(brokenKey, {
        customerId: selectedCustomerId,
        totalAmountCents,
        description: 'Teste de Violação Matemática Zero-Sum (-1 centavo)',
        splits: corruptedSplits,
      });

      if (!result.ok && result.error) {
        setTelemetry({
          type: 'error',
          title: 'Bloqueio Zero-Sum Confirmado (HTTP 422 Unprocessable Entity)',
          httpStatus: result.status,
          code: result.error.code,
          message: result.error.message,
          idempotencyKey: brokenKey,
          timestamp: new Date().toLocaleTimeString('pt-BR'),
        });
      }
      await refreshAllData();
    } finally {
      setActionLoading(false);
    }
  };

  // Ação de Estorno (Refund ou Re-estorno Idempotente)
  const handleRefundOrder = async (order: OrderDetails) => {
    setActionLoading(true);
    try {
      const result = await postRefundOrder(order.id);

      if (result.ok && result.data) {
        const isReplay = result.data.idempotentReplayed;
        setTelemetry({
          type: isReplay ? 'idempotent' : 'success',
          title: isReplay
            ? 'Re-estorno Idempotente Bloqueado (X-Idempotent-Replayed: true)'
            : 'Estorno Contábil (Refund) Executado no Ledger',
          httpStatus: result.status,
          code: isReplay ? 'REFUND_IDEMPOTENT_REPLAY' : 'ORDER_REFUNDED',
          message: isReplay
            ? `O pedido ${order.id.slice(0, 8)}... já estava REFUNDED. O backend retornou HTTP 200 sem debitar novamente as carteiras.`
            : `Pedido ${order.id.slice(0, 8)}... estornado! Foram gravados lançamentos inversos DEBIT (ORDER_REFUND) mantendo os lançamentos CREDIT originais intactos.`,
          idempotencyKey: `${order.idempotencyKey}:refund:*`,
          replayedHeader: result.idempotentReplayedHeader,
          timestamp: new Date().toLocaleTimeString('pt-BR'),
        });
        await refreshAllData();
      } else if (result.error) {
        setTelemetry({
          type: 'error',
          title: 'Falha ao Estornar Pedido',
          httpStatus: result.status,
          code: result.error.code,
          message: result.error.message,
          timestamp: new Date().toLocaleTimeString('pt-BR'),
        });
      }
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* HEADER BAR */}
      <header className="border-b border-slate-800/80 bg-slate-900/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-950/60">
              <Layers className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  AtomicSplit Console
                </h1>
                <span className="text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  ACID Ledger Engine
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Motor de Split de Pagamentos em Centavos (`Int`) • Livro-Razão Imutável • Optimistic Locking (`version`)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              API: http://localhost:3000/api
            </div>
            <button
              onClick={() => refreshAllData()}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${actionLoading ? 'animate-spin text-emerald-400' : ''}`}
              />
              Sincronizar
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] w-full mx-auto px-6 py-6 space-y-6 flex-1">
        {/* TELEMETRY / LIVE RESPONSE BANNER */}
        {telemetry && (
          <div
            className={`rounded-xl border p-4 transition-all shadow-lg ${
              telemetry.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-100'
                : telemetry.type === 'idempotent'
                  ? 'bg-amber-950/40 border-amber-500/50 text-amber-100'
                  : 'bg-rose-950/45 border-rose-500/50 text-rose-100'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                {telemetry.type === 'success' && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                )}
                {telemetry.type === 'idempotent' && (
                  <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                )}
                {telemetry.type === 'error' && (
                  <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm">
                      {telemetry.title}
                    </span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-black/40 border border-white/10">
                      HTTP {telemetry.httpStatus}
                    </span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-black/40 border border-white/10">
                      {telemetry.code}
                    </span>
                    {telemetry.replayedHeader !== null &&
                      telemetry.replayedHeader !== undefined && (
                        <span
                          className={`text-xs font-mono px-2 py-0.5 rounded font-semibold ${
                            telemetry.replayedHeader === 'true'
                              ? 'bg-amber-400/20 text-amber-200 border border-amber-400/40'
                              : 'bg-emerald-400/20 text-emerald-200 border border-emerald-400/40'
                          }`}
                        >
                          X-Idempotent-Replayed: {telemetry.replayedHeader}
                        </span>
                      )}
                  </div>
                  <p className="text-xs opacity-90 leading-relaxed">
                    {telemetry.message}
                  </p>
                  {telemetry.idempotencyKey && (
                    <p className="text-[11px] font-mono opacity-75">
                      Idempotency-Key: {telemetry.idempotencyKey} •{' '}
                      {telemetry.timestamp}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setTelemetry(null)}
                className="text-xs opacity-70 hover:opacity-100 underline cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* SEÇÃO 1: TOPO — PAINEL DE CARTEIRAS EM TEMPO REAL (WALLETS CARDS) */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                1. Carteiras em Tempo Real (Wallets & Optimistic Locking)
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Soma Global Custodiada:{' '}
              <strong className="text-emerald-400">
                {formatBRLFromCents(
                  walletParticipants.reduce(
                    (acc, p) => acc + (p.wallet?.balanceCents ?? 0),
                    0
                  )
                )}
              </strong>{' '}
              (
              {walletParticipants.reduce(
                (acc, p) => acc + (p.wallet?.balanceCents ?? 0),
                0
              )}{' '}
              centavos)
            </span>
          </div>

          {loadingInitial ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-36 rounded-xl bg-slate-900/70 border border-slate-800 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {walletParticipants.map((participant) => {
                const wallet = participant.wallet!;
                const isSelected = selectedWalletId === wallet.id;
                const isPlatform = participant.role === 'PLATFORM';

                return (
                  <div
                    key={wallet.id}
                    onClick={() => handleSelectWallet(wallet.id)}
                    className={`rounded-xl p-5 border transition-all cursor-pointer relative overflow-hidden ${
                      isSelected
                        ? 'bg-slate-900 border-emerald-500/70 shadow-lg shadow-emerald-950/50 ring-1 ring-emerald-500/40'
                        : 'bg-slate-900/60 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`p-2 rounded-lg ${
                            isPlatform
                              ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {isPlatform ? (
                            <Building2 className="w-4 h-4" />
                          ) : (
                            <Store className="w-4 h-4" />
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm text-white leading-tight">
                            {participant.name}
                          </h3>
                          <p className="text-[11px] font-mono text-slate-400">
                            Doc: {participant.document}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                            isPlatform
                              ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                              : 'bg-teal-500/15 text-teal-300 border-teal-500/30'
                          }`}
                        >
                          {participant.role}
                        </span>
                        <span
                          title="Versão de Concorrência Otimista (Optimistic Locking)"
                          className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-800 text-amber-300 border border-amber-500/30"
                        >
                          v{wallet.version}
                        </span>
                      </div>
                    </div>

                    <div className="my-3">
                      <div className="text-xs text-slate-400 mb-0.5">
                        Saldo Disponível
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-bold tracking-tight text-white font-mono">
                          {formatBRLFromCents(wallet.balanceCents)}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          {wallet.balanceCents} centavos
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-[11px] font-mono text-slate-400 truncate max-w-[170px]">
                        ID: {wallet.id.slice(0, 8)}...
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectWallet(wallet.id);
                        }}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-500 text-slate-950 font-semibold'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        {isSelected ? 'Extrato Ativo' : 'Ver Extrato (Ledger)'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* GRID PRINCIPAL: ESQUERDA (SIMULADOR DE CHECKOUT) + DIREITA (PEDIDOS & LEDGER) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* SEÇÃO 2: ESQUERDA — SIMULADOR DE CHECKOUT & TESTES DE RESILIÊNCIA */}
          <section className="lg:col-span-5 bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                  2. Simulador de Checkout & Resiliência
                </h2>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                POST /api/orders/checkout
              </span>
            </div>

            {/* Comprador (Customer) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                Cliente Comprador (`CUSTOMER`)
              </label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — CPF: {c.document} ({c.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            {/* Valor Total em Centavos + Atalhos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-emerald-400" />
                  Valor Total da Compra (em Centavos)
                </label>
                <span className="text-sm font-mono font-bold text-emerald-400">
                  {formatBRLFromCents(totalAmountCents)}
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={totalAmountCents}
                  onChange={(e) => {
                    const nextTotal = Math.max(
                      0,
                      Math.trunc(Number(e.target.value) || 0)
                    );
                    setTotalAmountCents(nextTotal);
                  }}
                  className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    setTotalAmountCents(10000);
                    applyStandardSplitCalculation(10000);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 border border-slate-700 cursor-pointer"
                >
                  R$ 100
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTotalAmountCents(25000);
                    applyStandardSplitCalculation(25000);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 border border-slate-700 cursor-pointer"
                >
                  R$ 250
                </button>
              </div>
            </div>

            {/* Botão Auto-Calcular Split Padrão */}
            <div>
              <button
                type="button"
                onClick={() => applyStandardSplitCalculation(totalAmountCents)}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Auto-Calcular Split Padrão (15% Plataforma / 50% Loja A / 35% Loja B)
              </button>
            </div>

            {/* Regras de Divisão (Splits) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">
                  Regras de Split da Transação (`splits`)
                </span>
                <span
                  className={`font-mono px-2 py-0.5 rounded ${
                    diffCents === 0
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  }`}
                >
                  Soma: {currentSplitsSumCents} / {totalAmountCents} centavos
                  {diffCents === 0 ? ' (Zero-Sum OK)' : ` (Dif: ${diffCents})`}
                </span>
              </div>

              <div className="space-y-2">
                {splitRows.map((row, index) => {
                  const pct =
                    totalAmountCents > 0
                      ? ((row.amountCents / totalAmountCents) * 100).toFixed(1)
                      : '0.0';

                  return (
                    <div
                      key={row.recipientId}
                      className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-white truncate">
                            {row.recipientName}
                          </span>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              row.splitType === 'PLATFORM_FEE'
                                ? 'bg-indigo-500/20 text-indigo-300'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {row.splitType}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          {formatBRLFromCents(row.amountCents)} ({pct}%)
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step={10}
                          value={row.amountCents}
                          onChange={(e) =>
                            handleUpdateSplitCents(
                              index,
                              Number(e.target.value)
                            )
                          }
                          className="w-28 rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-right text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                        />
                        <span className="text-[11px] font-mono text-slate-400">
                          ¢
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Última Idempotency-Key utilizada */}
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <KeyRound className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-slate-400 shrink-0">Última Chave:</span>
                <code className="font-mono text-amber-300 truncate">
                  {lastUsedIdempotencyKey ||
                    orders[0]?.idempotencyKey ||
                    '(nenhuma ainda)'}
                </code>
              </div>
            </div>

            {/* 3 BOTÕES DE AÇÃO PARA PROVAR A ROBUSTEZ DO BACKEND AO VIVO */}
            <div className="space-y-2.5 pt-1">
              {/* Botão 1 (Verde) */}
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleCheckoutNewKey}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                Processar Checkout (Nova Idempotency-Key)
              </button>

              {/* Botão 2 (Amarelo) */}
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleReplayLastIdempotencyKey}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 disabled:opacity-50 text-amber-200 font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Copy className="w-4 h-4 text-amber-400" />
                Repetir Última Chave (Testar Idempotência)
              </button>

              {/* Botão 3 (Vermelho) */}
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleForceZeroSumError}
                className="w-full py-2.5 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 disabled:opacity-50 text-rose-200 font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                Forçar Erro de 1 Centavo (Testar Zero-Sum HTTP 422)
              </button>
            </div>
          </section>

          {/* COLUNA DIREITA: SEÇÃO 3 (HISTÓRICO DE PEDIDOS) + SEÇÃO 4 (LEDGER STATEMENT) */}
          <div className="lg:col-span-7 space-y-6">
            {/* SEÇÃO 3: CENTRO/DIREITA — HISTÓRICO DE PEDIDOS E AÇÃO DE ESTORNO */}
            <section className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                    3. Histórico de Pedidos & Estorno Contábil ({orders.length})
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  GET /api/orders • POST /api/orders/:id/refund
                </span>
              </div>

              {orders.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  Nenhum pedido processado ainda. Utilize o simulador ao lado para realizar um checkout!
                </div>
              ) : (
                <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                  {orders.map((order) => {
                    const isPaid = order.status === 'PAID';
                    const isRefunded = order.status === 'REFUNDED';

                    return (
                      <div
                        key={order.id}
                        className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-white">
                              #{order.id.slice(0, 8)}
                            </span>
                            <span
                              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                                isPaid
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                              }`}
                            >
                              {order.status}
                            </span>
                            <span className="text-sm font-mono font-bold text-white">
                              {formatBRLFromCents(order.totalAmountCents)}
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">
                              ({order.totalAmountCents} ¢)
                            </span>
                            <span className="text-[11px] text-slate-400">
                              • {formatDateTime(order.createdAt)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-400">
                            <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                              Idempotency-Key: {order.idempotencyKey}
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {order.paymentSplits.map((sp) => (
                              <span
                                key={sp.id}
                                className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800"
                              >
                                {sp.recipient.name}:{' '}
                                {formatBRLFromCents(sp.amountCents)}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          {isPaid && (
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleRefundOrder(order)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-xs font-semibold transition cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                              Estornar (Refund)
                            </button>
                          )}

                          {isRefunded && (
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleRefundOrder(order)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/30 text-xs font-medium transition cursor-pointer"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                              Testar Re-estorno Idempotente
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* SEÇÃO 4: RODAPÉ/DIREITA — LIVRO-RAZÃO IMUTÁVEL (LEDGER STATEMENT) */}
            <section className="bg-slate-900/75 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3.5">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                    4. Livro-Razão Imutável (Ledger Statement)
                  </h2>
                </div>

                {statement && (
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-emerald-300 font-semibold">
                      {statement.user.name} ({statement.user.role})
                    </span>
                    <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-amber-300">
                      v{statement.version}
                    </span>
                  </div>
                )}
              </div>

              {!statement || statement.ledgerEntries.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs">
                  Nenhum lançamento contábil registrado para esta carteira ainda.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-900 text-[11px] font-mono uppercase text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Data / Hora</th>
                        <th className="py-2.5 px-3">Tipo</th>
                        <th className="py-2.5 px-3">Referência</th>
                        <th className="py-2.5 px-3 text-right">Valor</th>
                        <th className="py-2.5 px-3 text-right">
                          Saldo Após (`balanceAfter`)
                        </th>
                        <th className="py-2.5 px-3">Chave Idempotência</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-xs font-mono">
                      {statement.ledgerEntries.map((entry) => {
                        const isCredit = entry.type === 'CREDIT';
                        return (
                          <tr
                            key={entry.id}
                            className="hover:bg-slate-800/40 transition"
                          >
                            <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">
                              {formatDateTime(entry.createdAt)}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                  isCredit
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                }`}
                              >
                                {isCredit ? (
                                  <ArrowDownLeft className="w-3 h-3" />
                                ) : (
                                  <ArrowUpRight className="w-3 h-3" />
                                )}
                                {entry.type}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">
                              {entry.referenceType}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-bold whitespace-nowrap ${
                                isCredit ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {isCredit ? '+' : '-'}
                              {formatBRLFromCents(entry.amountCents)}
                              <span className="block text-[10px] text-slate-400 font-normal">
                                {entry.amountCents} ¢
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-white whitespace-nowrap">
                              {formatBRLFromCents(entry.balanceAfterCents)}
                              <span className="block text-[10px] text-slate-400 font-normal">
                                {entry.balanceAfterCents} ¢
                              </span>
                            </td>
                            <td
                              className="py-2.5 px-3 text-[11px] text-slate-400 max-w-[210px] truncate"
                              title={entry.idempotencyKey}
                            >
                              {entry.idempotencyKey}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

