# AtomicSplit — Marketplace Payment Split & Immutable Ledger Engine

Motor de liquidação financeira, divisão de pagamentos (Split Payment) e livro-razão contábil imutável (Ledger) projetado para marketplaces. O sistema garante conformidade transacional ACID, validação matemática de soma zero em centavos, controle de concorrência otimista em carteiras e idempotência estrita em operações de pagamento e estorno.

---

## Ambientes em Produção

* **Console de Simulação e Auditoria (Frontend):** `https://split.lucascustodio.me` (Mirror: `https://atom-split-frontend.onrender.com`)
* **API RESTful (Backend):** `https://atom-split.onrender.com/api`
* **Healthcheck:** `https://atom-split.onrender.com/health`

---

## Visão Geral da Arquitetura e Garantias Financeiras

Sistemas de pagamentos em marketplaces exigem que um único pagamento realizado por um comprador (`CUSTOMER`) seja particionado de forma atômica entre a taxa da plataforma (`PLATFORM_FEE`) e múltiplos vendedores (`SELLER_SHARE`), sem risco de perda de precisão decimal, condições de corrida (*race conditions*) ou cobranças duplicadas.

O **AtomicSplit** resolve esses problemas através de cinco pilares de engenharia:

1. **Aritmética Estrita em Centavos e Basis Points (`Int`):**
   Nenhum valor monetário utiliza ponto flutuante (`Float` ou `Double`), eliminando erros de representação binária (IEEE 754). Todos os valores são processados e persistidos como inteiros representando centavos de Real (`10000` = R$ 100,00) e taxas percentuais são expressas em *basis points* (`1500 bps` = 15.00%).

2. **Invariante de Soma Zero (Zero-Sum Validation):**
   Antes de abrir uma transação de banco de dados no checkout, o motor valida matematicamente se o somatório de todos os itens de `splits` corresponde exatamente ao `totalAmountCents` do pedido:
   $$\sum_{i=1}^{n} \text{split}_i = \text{totalAmountCents}$$
   Qualquer divergência de $1$ centavo para mais ou para menos aborta a requisição imediatamente com `HTTP 422 Unprocessable Entity`.

3. **Transações Atômicas ACID e Controle de Concorrência Otimista (OCC):**
   A criação do pedido, o registro das divisões (`PaymentSplit`), a atualização de saldo das carteiras (`Wallet`) e a gravação no livro-razão (`LedgerEntry`) ocorrem dentro de uma única transação interativa (`prisma.$transaction`). Cada carteira possui uma coluna `version` incrementada a cada mutação (`version = version + 1`), verificando a versão lida na cláusula `WHERE` para impedir *lost updates* em cenários de alta simultaneidade.

4. **Idempotência Determinística (Checkout e Estorno):**
   Mutacões financeiras exigem o envio do cabeçalho `Idempotency-Key`. Caso o cliente ou gateway reenvie uma requisição já processada (por timeout de rede ou duplo clique), a API intercepta a chave, evita o reprocessamento e retorna o estado consolidado com o cabeçalho `X-Idempotent-Replayed: true`. No nível do banco de dados, cada lançamento contábil possui sua própria chave determinística composta (`{orderIdempotencyKey}:split:{splitId}` e `{orderIdempotencyKey}:refund:{splitId}`).

5. **Livro-Razão Contábil Imutável (Append-Only Ledger):**
   A tabela `LedgerEntry` opera exclusivamente em modo *append-only*. Nenhum registro contábil é atualizado (`UPDATE`) ou removido (`DELETE`). Operações de estorno (`POST /api/orders/:orderId/refund`) verificam a suficiência de saldo das carteiras envolvidas e geram lançamentos compensatórios inversos (`type: DEBIT`, `referenceType: ORDER_REFUND`), preservando a trilha de auditoria completa e o histórico de saldo (`balanceAfterCents`).

---

## Stack Tecnológica

### Backend
* **Runtime & Linguagem:** Node.js, TypeScript
* **Framework Web:** Express.js (com Helmet, CORS restrito e Rate Limiting)
* **ORM & Banco de Dados:** Prisma ORM, PostgreSQL (Serverless via Neon em AWS `sa-east-1` com suporte a PgBouncer Connection Pooling)
* **Validação de Esquemas:** Zod
* **Testes Automatizados:** Jest e Supertest (Suítes Unitárias e de Integração E2E)

### Frontend (AtomicSplit Console)
* **Framework:** React 18, TypeScript, Vite
* **Estilização:** TailwindCSS, Lucide Icons

---

## Modelo de Dados

O esquema relacional foi estruturado em torno de quatro entidades principais:

* **`User`**: Representa os participantes do ecossistema (`PLATFORM`, `SELLER`, `CUSTOMER`) com validação de documento (CPF/CNPJ) e e-mail únicos.
* **`Wallet`**: Carteira virtual associada exclusivamente a recebedores (`PLATFORM` e `SELLER`). Armazena `balanceCents`, `currency` (`BRL`) e o contador `version` para bloqueio otimista.
* **`Order` & `PaymentSplit`**: Registra a intenção de compra (`PAID` ou `REFUNDED`), a `idempotencyKey` da transação e a lista de partições financeiras destinadas a cada recebedor.
* **`LedgerEntry`**: Registro imutável de movimentação financeira contendo `seq` (sequencial `BigInt`), `type` (`CREDIT` | `DEBIT`), `referenceType` (`ORDER_SPLIT` | `ORDER_REFUND`), `amountCents`, `balanceAfterCents` e `idempotencyKey`.

---

## Especificação da API (Endpoints)

### 1. Participantes e Carteiras

#### `GET /api/users`
Lista os participantes cadastrados e o estado atual de suas respectivas carteiras (parâmetro de consulta opcional: `?role=PLATFORM|SELLER|CUSTOMER`).

#### `POST /api/users`
Cadastra um novo participante. Quando o `role` é `SELLER` ou `PLATFORM`, a carteira correspondente (`Wallet`) é inicializada atomicamente com saldo zero e `version: 1`.

#### `GET /api/wallets/:walletId/statement`
Retorna o saldo atual da carteira, sua versão otimista e o extrato paginado de lançamentos do livro-razão (`ledgerEntries`) ordenado de forma decrescente.

---

### 2. Pedidos, Split Checkout e Estorno Contábil

#### `POST /api/orders/checkout`
Processa um pagamento com divisão atômica entre múltiplos recebedores.

* **Headers Obrigatórios:**
  * `Idempotency-Key`: Identificador único da operação (ex: UUID v4).

* **Exemplo de Payload:**
```json
{
  "customerId": "8334cd37-7f11-4493-83db-860894d20162",
  "totalAmountCents": 10000,
  "description": "Pedido Marketplace #001",
  "splits": [
    {
      "recipientId": "b014fb31-e907-4406-9fff-b22377b431a9",
      "splitType": "PLATFORM_FEE",
      "amountCents": 1500,
      "feeBps": 1500
    },
    {
      "recipientId": "9d3e684c-fd7a-46a1-af25-19a89b3adcba",
      "splitType": "SELLER_SHARE",
      "amountCents": 5000
    },
    {
      "recipientId": "67262ae1-a5a9-4ff6-a6c7-c38f98c23722",
      "splitType": "SELLER_SHARE",
      "amountCents": 3500
    }
  ]
}
```

* **Respostas:**
  * `201 Created`: Checkout processado com sucesso.
  * `200 OK`: Retorno idempotente de requisição já processada (`X-Idempotent-Replayed: true`).
  * `400 Bad Request`: Ausência de `Idempotency-Key` ou erro de validação estrutural (Zod).
  * `422 Unprocessable Entity`: Violação da regra Zero-Sum (soma dos splits diferente de `totalAmountCents`) ou recebedor sem carteira ativa.

#### `POST /api/orders/:orderId/refund`
Executa a reversão contábil completa de um pedido pago.

* **Comportamento:**
  * Verifica se o pedido encontra-se com status `PAID` (se já estiver `REFUNDED`, retorna `200 OK` com `X-Idempotent-Replayed: true`).
  * Valida se todas as carteiras que receberam valores no split possuem saldo disponível suficiente para o débito.
  * Debita o valor exato de cada carteira incrementando sua `version`, insere os registros `DEBIT` (`ORDER_REFUND`) no `LedgerEntry` e atualiza o status do pedido para `REFUNDED`.

#### `GET /api/orders` e `GET /api/orders/:orderId`
Consulta o histórico de pedidos processados com seus respectivos `paymentSplits` e `ledgerEntries`.

---

## Execução Local e Desenvolvimento

### Pré-requisitos
* Node.js 20+
* PostgreSQL 15+ (local via Docker ou instância remota no Neon)

### 1. Instalação de Dependências
```bash
git clone https://github.com/LucasSC98/atom-split.git
cd atom-split

# Instalar dependências do backend e do frontend
npm install
npm --prefix web install
```

### 2. Configuração de Variáveis de Ambiente
Crie um arquivo `.env` na raiz do projeto seguindo o modelo abaixo:
```env
PORT=3000
NODE_ENV=development
CORS_ORIGIN="http://localhost:5173"

# Conexão com Connection Pooler (PgBouncer) para execução da aplicação
DATABASE_URL="postgresql://user:password@host:5432/split_payments?schema=public"

# Conexão direta para execução de migrações (Prisma Migrate)
DIRECT_URL="postgresql://user:password@host:5432/split_payments?schema=public"
```

### 3. Migrações e Seed Inicial
O script de seed é idempotente (`upsert`) e provisiona automaticamente a conta da Plataforma, dois Lojistas com suas respectivas carteiras e um Cliente comprador para simulações imediatas:
```bash
npx prisma migrate deploy
npx prisma db seed
```

### 4. Inicialização dos Serviços
```bash
# Terminal 1: Iniciar API Backend (porta 3000)
npm run dev

# Terminal 2: Iniciar Console Frontend (porta 5173)
npm run dev:web
```

---

## Suíte de Testes Automatizados

O projeto conta com 15 testes automatizados distribuídos em 3 suítes (`users-wallets.spec.ts`, `orders-checkout.spec.ts` e `fintech-split-refund.e2e.spec.ts`), cobrindo:
* Criação atômica de usuários e carteiras e higienização de documentos;
* Validação de soma zero (bloqueio de divergência de 1 centavo com rollback integral);
* Garantia de idempotência em requisições repetidas de checkout e estorno;
* Integridade do livro-razão e controle de versão (`version`) após ciclos completos de pagamento e refund.

Para executar a suíte de testes:
```bash
npm test
```

---

## Autor

Desenvolvido por **Lucas Custódio** — [https://lucascustodio.me](https://lucascustodio.me)
