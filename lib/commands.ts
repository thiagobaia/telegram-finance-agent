import {
  addExtra,
  addSalario,
  clearPendingAction,
  deleteLastExpense,
  ExpenseRecord,
  getMonthExpenses,
  getSaldoMensal,
  PendingAction,
  setPendingAction,
} from "@/lib/sheets";
import { buildExpenseTable, formatBRL, parseMoneyInput } from "@/lib/format";
import {
  getCurrentMonth,
  getTodayRange,
  MonthInfo,
  parseMonthSlug,
} from "@/lib/months";

/**
 * Lê o mapeamento de nomes configurado em USUARIOS (.env), no formato:
 * USUARIOS="Thiago Baia:7555697290,Natalia de Brito:8874180041"
 * e devolve um Record<telegramUserId, nome>.
 */
function getUserNames(): Record<string, string> {
  const raw = process.env.USUARIOS ?? "";
  const map: Record<string, string> = {};

  raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [name, id] = pair.split(":").map((part) => part?.trim());
      if (name && id) map[id] = name;
    });

  return map;
}

function getUserName(telegramUserId: string): string {
  const names = getUserNames();
  return names[telegramUserId] ?? `Usuário ${telegramUserId}`;
}

function filterToday(expenses: ExpenseRecord[]): ExpenseRecord[] {
  const { start, end } = getTodayRange();
  return expenses.filter((e) => {
    const d = new Date(e.date);
    return d >= start && d < end;
  });
}

function toTableRows(expenses: ExpenseRecord[]) {
  return expenses.map((e) => ({
    amount: e.amount,
    description: e.description,
    category: e.category,
    userName: getUserName(e.telegramUserId),
  }));
}

async function buildMonthTable(month: MonthInfo): Promise<string> {
  const expenses = await getMonthExpenses(month.monthIndex, month.year);

  if (expenses.length === 0) {
    return `📂 Nenhum gasto encontrado em ${month.label}/${month.year}.`;
  }

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const saldo = await getSaldoMensal(month.monthIndex, month.year);

  return (
    `${buildExpenseTable(toTableRows(expenses))}\n\n` +
    `Total gasto em ${month.label}: R$ ${formatBRL(total)}\n` +
    `💰 Saldo disponível: R$ ${formatBRL(saldo)}`
  );
}

/**
 * /resumo — tabela detalhada do mês atual + total + saldo disponível.
 */
export async function handleResumo(): Promise<string> {
  return buildMonthTable(getCurrentMonth());
}

/**
 * /resumo-[mes] ou /detalhe-[mes] — tabela detalhada de um mês específico.
 */
export async function handleDetalheMes(slug: string): Promise<string> {
  const parsed = parseMonthSlug(slug);
  if (!parsed) {
    return `❓ Não reconheci o mês "${slug}". Use o nome completo, ex: /detalhe-outubro`;
  }
  return buildMonthTable(parsed);
}

/**
 * /resumo-dia — tabela detalhada exclusivamente do dia atual.
 */
export async function handleResumoDia(): Promise<string> {
  const month = getCurrentMonth();
  const all = await getMonthExpenses(month.monthIndex, month.year);
  const expenses = filterToday(all);

  if (expenses.length === 0) {
    return "🗓️ Nenhum gasto lançado hoje ainda.";
  }

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return `${buildExpenseTable(toTableRows(expenses))}\n\nTotal de hoje: R$ ${formatBRL(total)}`;
}

function buildCategoriesSummary(
  expenses: ExpenseRecord[],
  monthLabel: string | null,
): string {
  if (expenses.length === 0) {
    return monthLabel
      ? `📂 Nenhum gasto encontrado em ${monthLabel}.`
      : "📂 Nenhum gasto registrado este mês ainda.";
  }

  const totals = new Map<string, number>();
  for (const e of expenses) {
    totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const parts = sorted.map(
    ([category, total]) => `${category}: R$ ${formatBRL(total)}`,
  );

  const prefix = monthLabel
    ? `📂 Gastos por categoria (${monthLabel}):\n`
    : "📂 Gastos por categoria (mês atual):\n";

  return prefix + parts.join(" | ");
}

/**
 * /categorias — agrupa os gastos do mês atual por categoria.
 */
export async function handleCategorias(): Promise<string> {
  const month = getCurrentMonth();
  const expenses = await getMonthExpenses(month.monthIndex, month.year);
  return buildCategoriesSummary(expenses, null);
}

/**
 * /categorias-[mes] — agrupa os gastos de um mês específico por categoria.
 */
export async function handleCategoriasMes(slug: string): Promise<string> {
  const parsed = parseMonthSlug(slug);
  if (!parsed) {
    return `❓ Não reconheci o mês "${slug}". Use, ex: /categorias-outubro`;
  }

  const expenses = await getMonthExpenses(parsed.monthIndex, parsed.year);
  return buildCategoriesSummary(expenses, parsed.label);
}

/**
 * /hoje — lista simples (não tabela) dos lançamentos de hoje.
 */
export async function handleHoje(): Promise<string> {
  const month = getCurrentMonth();
  const all = await getMonthExpenses(month.monthIndex, month.year);
  const expenses = filterToday(all);

  if (expenses.length === 0) {
    return "🗓️ Nenhum gasto lançado hoje ainda.";
  }

  const lines = expenses.map(
    (e) => `• R$ ${formatBRL(e.amount)} - ${e.description} (${e.category})`,
  );
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return `🗓️ Gastos de hoje:\n${lines.join("\n")}\n\nTotal: R$ ${formatBRL(total)}`;
}

/**
 * /desfazer — apaga o último gasto lançado no mês atual e devolve o
 * valor ao saldo mensal.
 */
export async function handleDesfazer(): Promise<string> {
  const month = getCurrentMonth();
  const removed = await deleteLastExpense(month.monthIndex, month.year);

  if (!removed) {
    return "🤷 Não há nenhum gasto registrado para desfazer.";
  }

  return `🗑️ Removido: R$ ${formatBRL(removed.amount)} - ${removed.description} (${removed.category})`;
}

function buildDivisionSummary(
  expenses: ExpenseRecord[],
  monthLabel: string | null,
): string {
  if (expenses.length === 0) {
    return monthLabel
      ? `👥 Nenhum gasto encontrado em ${monthLabel}.`
      : "👥 Nenhum gasto registrado este mês ainda.";
  }

  const totals = new Map<string, number>();
  for (const e of expenses) {
    totals.set(
      e.telegramUserId,
      (totals.get(e.telegramUserId) ?? 0) + e.amount,
    );
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const lines = sorted.map(
    ([telegramUserId, total]) =>
      `${getUserName(telegramUserId)}: R$ ${formatBRL(total)}`,
  );

  const prefix = monthLabel
    ? `👥 Divisão de gastos (${monthLabel}):\n`
    : "👥 Divisão de gastos (mês atual):\n";

  return prefix + lines.join("\n");
}

/**
 * /divisao — soma os gastos do mês atual agrupados por telegramUserId.
 */
export async function handleDivisao(): Promise<string> {
  const month = getCurrentMonth();
  const expenses = await getMonthExpenses(month.monthIndex, month.year);
  return buildDivisionSummary(expenses, null);
}

/**
 * /divisao-[mes] — mesmo agrupamento, filtrando por um mês específico.
 */
export async function handleDivisaoMes(slug: string): Promise<string> {
  const parsed = parseMonthSlug(slug);
  if (!parsed) {
    return `❓ Não reconheci o mês "${slug}". Use, ex: /divisao-outubro`;
  }

  const expenses = await getMonthExpenses(parsed.monthIndex, parsed.year);
  return buildDivisionSummary(expenses, parsed.label);
}

/**
 * /saldo — saldo disponível (SALDO MENSAL) do mês atual.
 */
export async function handleSaldo(): Promise<string> {
  const month = getCurrentMonth();
  const saldo = await getSaldoMensal(month.monthIndex, month.year);
  return `💰 Saldo disponível em ${month.label}: R$ ${formatBRL(saldo)}`;
}

/**
 * /adicionar-salario e /adicionar-extra — inicia o fluxo de duas etapas:
 * pede o valor e marca o usuário como "aguardando resposta" (via aba
 * "Estado" na planilha). Se o valor já vier junto no comando
 * (ex: "/adicionar-salario 3500"), registra na hora, sem precisar da
 * segunda etapa.
 */
export async function handleIniciarAdicionar(
  action: PendingAction,
  telegramUserId: string,
  inlineValueText?: string,
): Promise<string> {
  const inlineValue = inlineValueText ? parseMoneyInput(inlineValueText) : null;

  if (inlineValue !== null) {
    return resolvePendingValue(action, telegramUserId, inlineValue);
  }

  await setPendingAction(telegramUserId, action);
  const label = action === "salario" ? "salário" : "valor extra";
  return `💰 Digite o valor do ${label} (ex: 3500 ou 3500,00). Envie /cancelar para desistir.`;
}

/**
 * Resolve um valor já validado para a ação pendente (salário ou extra),
 * somando ao saldo mensal do mês atual e limpando o estado do usuário.
 */
async function resolvePendingValue(
  action: PendingAction,
  telegramUserId: string,
  value: number,
): Promise<string> {
  const month = getCurrentMonth();
  const label = action === "salario" ? "Salário" : "Valor extra";

  const novoSaldo =
    action === "salario"
      ? await addSalario(month.monthIndex, month.year, value)
      : await addExtra(month.monthIndex, month.year, value);

  await clearPendingAction(telegramUserId);

  return `✅ ${label} de R$ ${formatBRL(value)} adicionado ao saldo de ${month.label}.\n💰 Saldo atual: R$ ${formatBRL(novoSaldo)}`;
}

/**
 * Chamado pelo webhook quando o usuário tem uma ação pendente
 * (setada por handleIniciarAdicionar) e manda uma mensagem de texto comum
 * (não um comando). Tenta interpretar o texto como o valor esperado.
 */
export async function handleValorPendente(
  action: PendingAction,
  telegramUserId: string,
  text: string,
): Promise<string> {
  const value = parseMoneyInput(text);

  if (value === null) {
    return '❌ Não entendi esse valor. Digite apenas o número, ex: "3500" ou "3500,00". Envie /cancelar para desistir.';
  }

  return resolvePendingValue(action, telegramUserId, value);
}

/**
 * /cancelar — sai do fluxo de /adicionar-salario ou /adicionar-extra.
 */
export async function handleCancelar(telegramUserId: string): Promise<string> {
  await clearPendingAction(telegramUserId);
  return "✅ Operação cancelada.";
}

/**
 * /ajuda — texto estático de ajuda. Usa tags HTML pois o bot envia
 * mensagens com parse_mode "HTML".
 */
export function handleAjuda(): string {
  return `🤖 <b>Baú da Felicidade — Guia Completo</b>

Bem-vindo(a)! Este bot usa Inteligência Artificial para facilitar o nosso controle financeiro. Veja como aproveitar ao máximo:

✍️ <b>1. COMO REGISTRAR GASTOS</b>
Não precisa usar comandos difíceis! Basta escrever naturalmente como se estivesse mandando uma mensagem normal. A IA vai ler, entender a categoria e salvar no banco de dados.

<i>Exemplos de como escrever:</i>
• "Gastei 45 no iFood hoje"
• "Paguei 120 de Uber ontem"
• "1200 de aluguel"
• "Comprei remédio na farmácia por 85,50"

💡 <b>Dica de Ouro:</b> A IA funciona melhor quando você escreve o <b>valor</b> e o <b>motivo</b> na mesma frase. Se você não escrever a data, ela vai registrar o gasto no dia de "hoje".

💰 <b>2. CONTROLE DE RENDA E SALDO</b>
Para o bot calcular se estamos no azul ou no vermelho, informe as entradas:
• /adicionar-salario — Inicia o passo a passo para registrar o salário no mês atual.
• /adicionar-extra — Registra um dinheiro extra que entrou (ex: venda de algo, freela, presente).
• /saldo — Mostra rapidamente quanto dinheiro ainda temos disponível neste mês (Total de Entradas - Total de Gastos).
• /cancelar — Começou a adicionar uma renda e desistiu ou clicou sem querer? Use para abortar a ação.

📊 <b>3. RESUMOS E HISTÓRICO</b>
Acompanhe os detalhes do que já foi gasto:
• /resumo — Mostra a tabela completa de gastos do mês atual, somando tudo e exibindo o saldo restante.
• /resumo-dia — Mostra a tabela detalhada apenas do que foi gasto exatamente hoje e usuario que gastou.
• /hoje — Uma listinha rápida e resumida dos lançamentos de hoje (ótimo para conferir se você não esqueceu de anotar nada).
• /detalhe-[mês] (ex: /detalhe-agosto) — Quer consultar o passado? Use este comando com o nome de qualquer mês para ver a tabela detalhada dele.

🏷️ <b>4. CATEGORIAS (Para onde vai o dinheiro?)</b>
• /categorias — Soma os gastos do mês atual e mostra o total por área (ex: X em Alimentação, Y em Transporte).
• /categorias-[mês] (ex: /categorias-agosto) — Mostra os totais por categoria de um mês passado.

⚖️ <b>5. DIVISÃO DO CASAL</b>
• /divisao — Calcula automaticamente quanto cada pessoa lançou de gastos no mês atual.
• /divisao-[mês] (ex: /divisao-agosto) — Mostra a divisão de um mês passado.

⚠️ <b>6. CORREÇÕES</b>
• /desfazer — Salvou um valor errado? Calma! Use este comando para apagar <b>imediatamente o ÚLTIMO registro</b> salvo no banco.
• /ajuda — Mostra este manual novamente.`;
}
