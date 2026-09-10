# Telegram Finance Agent (Google Sheets + Groq)

Agente financeiro via Telegram: envie uma mensagem como "gastei 45 no ifood hoje"
e o bot extrai valor, categoria e data com um LLM (Llama via Groq), valida com
Zod e salva na planilha do Google Sheets. Cada mês vira uma aba própria
(ex: "setembro-2026"), com controle de orçamento mensal (SALDO MENSAL).

## 1. Instalar dependências

```bash
npm install
```

## 2. Criar a Service Account do Google e liberar acesso à planilha

1. No [Google Cloud Console](https://console.cloud.google.com/), crie (ou reutilize) um projeto.
2. Ative a **Google Sheets API** para esse projeto.
3. Em "IAM e administrador" → "Contas de serviço", crie uma nova Service Account.
4. Gere uma chave JSON para essa conta (Ações → Gerenciar chaves → Adicionar chave → JSON). O arquivo baixado contém `client_email` e `private_key` — são exatamente os valores de `GOOGLE_SERVICE_EMAIL` e `GOOGLE_PRIVATE_KEY`.
5. Crie uma planilha nova no Google Sheets (pode ficar vazia, o bot cria as abas sozinho).
6. **Compartilhe** essa planilha com o e-mail da Service Account (`...@...iam.gserviceaccount.com`), dando permissão de **Editor**. Sem esse passo o bot não consegue ler nem escrever nada.
7. Pegue o ID da planilha na URL: `https://docs.google.com/spreadsheets/d/<ESTE_ID_AQUI>/edit`.

## 3. Pegar a chave da Groq

Crie uma conta em [console.groq.com](https://console.groq.com/) e gere uma API key — é o valor de `GROQ_API_KEY`.

## 4. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Preencha no `.env`:
- `TELEGRAM_BOT_TOKEN`: token obtido com o @BotFather no Telegram. **Nunca compartilhe esse valor** (nem aqui no chat da IA, nem em repositórios públicos) — se ele vazar, revogue com `/revoke` no @BotFather e gere um novo imediatamente.
- `ALLOWED_TELEGRAM_IDS`: IDs numéricos do Telegram autorizados a usar o bot, separados por vírgula. Para descobrir seu ID, fale com @userinfobot no Telegram.
- `GROQ_API_KEY`: chave da API da Groq (passo 3).
- `GOOGLE_SHEET_ID`: o ID da planilha (passo 7 acima).
- `GOOGLE_SERVICE_EMAIL`: o `client_email` do JSON da Service Account.
- `GOOGLE_PRIVATE_KEY`: o `private_key` do JSON da Service Account. Mantenha as quebras de linha como `\n` literais e tudo entre aspas duplas, exatamente como vem no JSON original. **Não deixe em branco** — sem isso o bot não autentica no Google.
- `USUARIOS`: mapeamento `"Nome Completo:telegramUserId,Nome2:telegramUserId2"`, usado para mostrar nomes (em vez de IDs) nos relatórios como `/divisao`.

> Não existe `DATABASE_URL` nem Prisma — os dados vivem inteiramente no Google Sheets.

## 5. Como a planilha fica organizada

- **Uma aba por mês**, nomeada `mes-ano` (ex: `setembro-2026`, `outubro-2026`). O bot cria a aba automaticamente (com cabeçalho) na primeira vez que algo é registrado naquele mês.
- Colunas **A a G**: `ID, Amount, Description, Category, Date, TelegramUserId, CreatedAt` — a tabela de gastos em si.
- Colunas **H1/I1** (só na linha de cabeçalho): rótulo `SALDO MENSAL` e o valor numérico do saldo daquele mês. Cada gasto **subtrai** desse valor; `/adicionar-salario` e `/adicionar-extra` **somam** a ele. Fica na linha 1 de propósito, para nunca ser afetado quando uma linha de gasto é inserida ou apagada (`/desfazer`).
- Uma aba extra, **"Estado"**, guarda temporariamente quem está no meio do fluxo de `/adicionar-salario` ou `/adicionar-extra` (aguardando o valor ser digitado). Você pode ignorá-la — é uso interno do bot.

## 6. Rodar localmente

```bash
npm run dev
```

O webhook fica disponível em `http://localhost:3000/api/webhook/telegram`.

Como o Telegram não consegue chamar `localhost`, exponha a porta com uma ferramenta de túnel, por exemplo `ngrok`:

```bash
ngrok http 3000
```

Copie a URL pública gerada (ex: `https://abcd1234.ngrok-free.app`).

## 7. Configurar o Webhook no Telegram

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_PUBLICA>/api/webhook/telegram"
```

Uma resposta `{"ok":true,"result":true,"description":"Webhook was set"}` confirma que deu certo. Para conferir o status a qualquer momento:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## 8. Comandos disponíveis

Comandos (começam com `/`) são resolvidos direto na planilha e **nunca** passam pelo LLM.

**Orçamento mensal:**

| Comando | O que faz |
|---|---|
| `/adicionar-salario` | Inicia o fluxo: o bot pergunta o valor, você responde (ex: `3500`), e ele soma ao saldo do mês atual. Também aceita `/adicionar-salario 3500` direto, sem a segunda etapa. |
| `/adicionar-extra` | Mesma coisa, para uma renda extra. |
| `/saldo` | Mostra o saldo disponível (SALDO MENSAL) do mês atual. |
| `/cancelar` | Sai do fluxo de `/adicionar-salario` ou `/adicionar-extra` sem registrar nada. |

**Consultas e relatórios:**

| Comando | O que faz |
|---|---|
| `/resumo` | Tabela detalhada (Valor, Produto, Categoria, Usuário) + total + saldo disponível do mês atual. |
| `/resumo-[mês]` ou `/detalhe-[mês]` | Tabela detalhada de um mês específico, ex: `/detalhe-outubro`. |
| `/resumo-dia` | Tabela detalhada apenas dos gastos de hoje. |
| `/categorias` | Total agrupado por categoria no mês atual. |
| `/categorias-[mês]` | Total por categoria de um mês específico, ex: `/categorias-outubro`. |
| `/hoje` | Lista simples (não tabela) dos lançamentos de hoje, pra conferência rápida. |
| `/desfazer` | Apaga a última linha de gasto do mês atual e devolve o valor ao saldo mensal. |
| `/divisao` | Soma os gastos do mês atual por pessoa (usa `USUARIOS` pra mostrar nomes). |
| `/divisao-[mês]` | Mesmo agrupamento, filtrando por um mês específico, ex: `/divisao-outubro`. |
| `/ajuda` | Explica os comandos e como escrever para a IA entender melhor. |

Os comandos com mês (`-outubro`, `-marco`, etc.) assumem o ano atual — exceto quando o mês pedido ainda não chegou este ano, caso em que assumem o ano anterior.

## 9. Testar

Envie no Telegram, para o seu bot:
```
/adicionar-salario
```
O bot responde pedindo o valor. Envie, por exemplo:
```
5000
```
Ele confirma e soma ao saldo do mês. Depois, envie um gasto:
```
gastei 45 no ifood hoje
```
O bot deve responder:
```
✅ R$ 45.00 salvos em Alimentação
📝 iFood
💰 Saldo de Setembro: R$ 4.955,00
```
E tanto a linha do gasto quanto o novo saldo devem aparecer na aba do mês atual da sua planilha.

## Deploy em produção

Ao publicar (Vercel, por exemplo), gere as variáveis de ambiente no painel do provedor (nunca commite o `.env`) e aponte o webhook do Telegram para a URL final de produção, seguindo o mesmo comando `setWebhook` do passo 7. Como todo o armazenamento é no Google Sheets, não há necessidade de provisionar nenhum banco de dados gerenciado.
