# AtomicSplit — Motor de Split de Pagamentos & Livro-Razão Imutável

API RESTful e Console Financeiro de **Split de Pagamentos para Marketplaces** com foco em integridade contábil ACID, valores monetários estritamente em centavos (`Int`), Livro-Razão Imutável (*Append-Only Ledger*), Idempotência com verificação de hash de payload (`SHA-256`) e Controle de Concorrência Otimista (`version` + retry exponencial com jitter).

---

## 🚀 Deploy & Demo Online

- **🔗 Link da Demo (Painel Web)**: `[INSERIR_URL_DA_DEMO_AQUI]`
- **🔗 Endpoint da API (Healthcheck)**: `[INSERIR_URL_DA_API_AQUI]/health`

> ⚠️ **Aviso sobre Cold Start (Plano Gratuito do Render)**:
> A API está hospedada no plano gratuito (*Free Tier*) do **Render**, que hiberna após 15 minutos de inatividade. **No primeiro acesso, a API pode levar cerca de 1 minuto para acordar ("cold start")**. As requisições subsequentes respondem em poucos milissegundos.

### Arquitetura de Deploy
1. **Banco de Dados — Neon (Serverless PostgreSQL)**:
   - Provê duas strings de conexão: uma com *connection pooler* PgBouncer (`DATABASE_URL`, usada pela aplicação em runtime) e uma conexão direta (`DIRECT_URL`, usada pelo Prisma Migrate no momento do deploy).
   - Aplica *constraints* nativas no PostgreSQL (`CHECK (balance_cents >= 0)`, `CHECK (amount_cents > 0)`) e trigger `BEFORE UPDATE OR DELETE ON ledger_entries` para garantir que o livro-razão seja estritamente *append-only*.
2. **Backend API — Render (Web Service Node.js)**:
   - **Build Command**: `npm install && npm run build:render` (`prisma generate && tsc`)
   - **Start Command**: `npm run start:render` (`prisma migrate deploy && node dist/server.js`)
   - Conta com `trust proxy` habilitado, CORS restrito às origens autorizadas em produção e *Rate Limiting* por IP (`120 req/min` geral e `30 req/min` para `checkout` e `refund`, com `/health` isento).
3. **Painel Web (`/web`) — Site Estático (Render Static Site / Vercel)**:
   - **Root Directory**: `web`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`

### Variáveis de Ambiente de Produção

#### Backend (Render Web Service)
| Variável | Obrigatória | Descrição / Exemplo |
|---|---|---|
| `NODE_ENV` | Sim | `production` |
| `PORT` | Automática (Render) | Porta HTTP injetada pelo Render (default local: `3000`) |
| `DATABASE_URL` | Sim | Connection string **com pooler** da Neon (`postgresql://user:pass@ep-...-pooler.region.aws.neon.tech/neondb?sslmode=require&pgbouncer=true`) |
| `DIRECT_URL` | Sim | Connection string **direta (sem pooler)** da Neon para execução de `prisma migrate deploy` (`postgresql://user:pass@ep-....region.aws.neon.tech/neondb?sslmode=require`) |
| `CORS_ORIGIN` | Sim (em produção) | Lista de origens permitidas separadas por vírgula (ex: `https://atomicsplit-web.onrender.com`) |

#### Frontend (`web/` — Static Site)
| Variável | Obrigatória | Descrição / Exemplo |
|---|---|---|
| `VITE_API_URL` | Sim | URL base da API em produção incluindo `/api` (ex: `https://atomicsplit-api.onrender.com/api`) |

---

## 🏛️ Pilares Arquiteturais

1. **Manipulação de Dinheiro em Centavos (`Int`)**: Nenhum valor financeiro usa `Float` ou `Decimal`. Todos os saldos (`balanceCents`), totais (`totalAmountCents`) e divisões (`amountCents`) são inteiros em centavos (`R$ 100,00 = 10000`) validados até o limite seguro de `Int32` (`2_000_000_000`).
2. **Padrão Ledger Imutável (*Append-Only*)**: `Wallet.balanceCents` nunca sofre `UPDATE` isolado. Toda movimentação financeira ocorre dentro de uma transação ACID (`prisma.$transaction`) acompanhada de um registro imutável `CREDIT` ou `DEBIT` em `ledger_entries`, ordenado deterministicamente por sequência monotônica (`seq BigInt`) e protegido por trigger SQL `BEFORE UPDATE OR DELETE`.
3. **Idempotência Escopada por Cliente com Hash de Payload**: O checkout exige `Idempotency-Key` com constraint `@@unique([customerId, idempotencyKey])` e valida o `requestHash` (`SHA-256` do JSON canônico). Reenviar a mesma chave com o mesmo payload retorna `HTTP 200` (`X-Idempotent-Replayed: true`); reutilizar a mesma chave com payload diferente retorna `HTTP 422` (`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`).
4. **Concorrência Otimista (`version`) + Retry Exponencial**: Atualizações de carteira utilizam `updateMany` condicional na versão lida (`version`), lançando `OptimisticLockError` quando `count === 0` e reexecutando a transação via `withOptimisticRetry` (até 8 tentativas com backoff exponencial de 10ms a 200ms + jitter).

---

## 💻 Execução Local

```bash
# 1. Subir PostgreSQL via Docker Compose (cria split_payments e split_payments_test)
docker compose up -d

# 2. Instalar dependências do Backend e aplicar migrations
npm install
npx prisma migrate dev

# 3. Popular banco de desenvolvimento com os 4 atores iniciais (idempotente)
npm run db:seed

# 4. Rodar suíte de testes (isola automaticamente no banco split_payments_test)
npm test

# 5. Iniciar API (http://localhost:3000) e Painel Web (http://localhost:5173)
npm run dev
npm run dev:web
```
