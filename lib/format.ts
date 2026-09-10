export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Interpreta um valor monetário digitado livremente pelo usuário
 * (ex: "3500", "3.500,00", "R$ 1500,50", "1500.50") e devolve um número
 * positivo, ou null se não for possível interpretar como valor válido.
 */
export function parseMoneyInput(raw: string): number | null {
  let cleaned = raw.replace(/r\$/gi, "").trim();
  if (!cleaned) return null;

  if (cleaned.includes(",")) {
    // Formato BR (ex: "1.500,50"): remove separador de milhar (.) e troca
    // a vírgula decimal por ponto.
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

function padCell(text: string, width: number): string {
  return truncate(text, width).padEnd(width, " ");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface TableRow {
  amount: number;
  description: string;
  category: string;
  userName: string;
}

// Larguras fixas das colunas, pensadas para caber bem numa fonte
// monospace dentro da largura de uma mensagem do Telegram.
const COLS = {
  valor: 10,
  produto: 16,
  categoria: 13,
  usuario: 14,
};

/**
 * Monta uma tabela ASCII/monospace (Valor | Produto | Categoria | Usuário)
 * já envolvida em <pre> para renderizar corretamente no Telegram
 * (o bot envia mensagens com parse_mode "HTML").
 */
export function buildExpenseTable(rows: TableRow[]): string {
  const header =
    padCell("Valor", COLS.valor) +
    padCell("Produto", COLS.produto) +
    padCell("Categoria", COLS.categoria) +
    padCell("Usuário", COLS.usuario);

  const separator = "-".repeat(
    COLS.valor + COLS.produto + COLS.categoria + COLS.usuario
  );

  const lines = rows.map(
    (r) =>
      padCell(`R$ ${formatBRL(r.amount)}`, COLS.valor) +
      padCell(r.description, COLS.produto) +
      padCell(r.category, COLS.categoria) +
      padCell(r.userName, COLS.usuario)
  );

  const raw = [header, separator, ...lines].join("\n");
  return `<pre>${escapeHtml(raw)}</pre>`;
}
