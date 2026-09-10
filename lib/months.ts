export const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Remove acentos para comparar/normalizar nomes de mês sem depender de acentuação exata. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export interface MonthInfo {
  monthIndex: number; // 0-11
  year: number;
  label: string; // "Setembro" (exibição, com acento)
  tabName: string; // "setembro-2026" (nome da aba na planilha)
}

/**
 * Nome da aba na planilha para um mês/ano. Usamos "mes-ano" (com traço) em
 * vez de "mes/ano": o caractere "/" não é permitido em nomes de aba do
 * Google Sheets. O mês é normalizado (sem acento) para evitar qualquer
 * problema de encoding nas ranges da API.
 */
export function getMonthTabName(monthIndex: number, year: number): string {
  return `${normalize(MONTHS_PT[monthIndex])}-${year}`;
}

export function getCurrentMonth(reference = new Date()): MonthInfo {
  const monthIndex = reference.getMonth();
  const year = reference.getFullYear();
  return {
    monthIndex,
    year,
    label: capitalize(MONTHS_PT[monthIndex]),
    tabName: getMonthTabName(monthIndex, year),
  };
}

/** Mesma coisa que getCurrentMonth, mas para qualquer data (não só "agora"). */
export function monthInfoFromDate(date: Date): MonthInfo {
  return getCurrentMonth(date);
}

/**
 * Faz o parse dinâmico de um slug de mês (ex: "outubro", "marco") vindo de
 * comandos como /resumo-outubro, /categorias-outubro, /divisao-outubro.
 * Assume o ano atual, exceto quando o mês pedido ainda não chegou este ano
 * — nesse caso assume o ano anterior (o bot sempre olha pra trás no tempo).
 */
export function parseMonthSlug(slug: string): MonthInfo | null {
  const normalizedSlug = normalize(slug);
  const monthIndex = MONTHS_PT.findIndex((m) => normalize(m) === normalizedSlug);
  if (monthIndex === -1) return null;

  const now = new Date();
  const year =
    monthIndex > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();

  return {
    monthIndex,
    year,
    label: capitalize(MONTHS_PT[monthIndex]),
    tabName: getMonthTabName(monthIndex, year),
  };
}

export function getTodayRange(reference = new Date()) {
  const start = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
    0,
    0,
    0,
    0
  );
  const end = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return { start, end };
}
