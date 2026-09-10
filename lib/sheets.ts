import { google, sheets_v4 } from "googleapis";
import { getMonthTabName } from "@/lib/months";

// Colunas A-G da tabela de gastos de cada aba mensal.
const EXPENSE_COLUMNS_HEADER = [
  "ID",
  "Amount",
  "Description",
  "Category",
  "Date",
  "TelegramUserId",
  "CreatedAt",
];

// O saldo mensal fica em H1 (rótulo) / I1 (valor) — DENTRO da linha de
// cabeçalho (linha 1), de propósito: como os gastos são inseridos/apagados
// nas linhas 2+ (via append/deleteDimension), manter o saldo na linha 1
// garante que ele nunca é afetado por essas operações de linha.
const SALDO_LABEL = "SALDO MENSAL";
const SALDO_RANGE_SUFFIX = "!I1";

const STATE_SHEET_TITLE = "Estado";
const STATE_HEADER = ["TelegramUserId", "PendingAction", "UpdatedAt"];

export interface ExpenseRecord {
  id: string;
  amount: number;
  description: string;
  category: string;
  date: string; // ISO 8601
  telegramUserId: string;
  createdAt: string; // ISO 8601
}

export type PendingAction = "salario" | "extra";

interface SheetInfo {
  sheetId: number;
  title: string;
}

let cachedClient: sheets_v4.Sheets | null = null;

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID não configurado no .env");
  return id;
}

function getSheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_SERVICE_EMAIL;
  // No .env, as quebras de linha da chave privada vêm escapadas como "\n"
  // literais; aqui elas são convertidas de volta para quebras de linha reais.
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error(
      "GOOGLE_SERVICE_EMAIL ou GOOGLE_PRIVATE_KEY não configurados no .env"
    );
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

async function findSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string
): Promise<SheetInfo | null> {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const found = metadata.data.sheets?.find((s) => s.properties?.title === title);
  const sheetId = found?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) return null;
  return { sheetId, title };
}

async function createSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string
): Promise<SheetInfo> {
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });

  const sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Falha ao criar a aba "${title}" na planilha.`);
  }

  return { sheetId, title };
}

/**
 * Garante que a aba de um mês específico (ex: "setembro-2026") existe.
 * Se precisar criar, já escreve o cabeçalho A1:G1 + o rótulo/valor inicial
 * do saldo mensal em H1/I1 (começando zerado) em uma única chamada.
 */
async function ensureMonthSheetReady(
  monthIndex: number,
  year: number
): Promise<{
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  sheetId: number;
  tabName: string;
}> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const tabName = getMonthTabName(monthIndex, year);

  let info = await findSheet(sheets, spreadsheetId, tabName);

  if (!info) {
    info = await createSheet(sheets, spreadsheetId, tabName);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1:I1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[...EXPENSE_COLUMNS_HEADER, SALDO_LABEL, 0]],
      },
    });
  }

  return { sheets, spreadsheetId, sheetId: info.sheetId, tabName };
}

async function ensureStateSheetReady(): Promise<{
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  title: string;
}> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const title = STATE_SHEET_TITLE;

  const info = await findSheet(sheets, spreadsheetId, title);

  if (!info) {
    await createSheet(sheets, spreadsheetId, title);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1:C1`,
      valueInputOption: "RAW",
      requestBody: { values: [STATE_HEADER] },
    });
  }

  return { sheets, spreadsheetId, title };
}

function rowToExpense(row: Array<string | number>): ExpenseRecord | null {
  const [id, amount, description, category, date, telegramUserId, createdAt] =
    row;

  if (id === undefined || id === null || id === "") return null;

  const amountNum = typeof amount === "number" ? amount : Number(amount);
  if (Number.isNaN(amountNum)) return null;

  return {
    id: String(id),
    amount: amountNum,
    description: description !== undefined ? String(description) : "",
    category: category !== undefined ? String(category) : "Outros",
    date: date !== undefined ? String(date) : "",
    telegramUserId:
      telegramUserId !== undefined ? String(telegramUserId) : "",
    createdAt: createdAt !== undefined ? String(createdAt) : "",
  };
}

async function readSaldo(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string
): Promise<number> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}${SALDO_RANGE_SUFFIX}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const raw = res.data.values?.[0]?.[0];
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isNaN(value) ? 0 : value;
}

async function adjustSaldo(
  monthIndex: number,
  year: number,
  delta: number
): Promise<number> {
  const { sheets, spreadsheetId, tabName } = await ensureMonthSheetReady(
    monthIndex,
    year
  );

  const current = await readSaldo(sheets, spreadsheetId, tabName);
  const updated = current + delta;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}${SALDO_RANGE_SUFFIX}`,
    valueInputOption: "RAW",
    requestBody: { values: [[updated]] },
  });

  return updated;
}

/**
 * Insere um novo gasto na aba do mês (colunas A:G) e SUBTRAI o valor
 * do saldo mensal (I1). Retorna o saldo já atualizado.
 */
export async function appendExpense(
  monthIndex: number,
  year: number,
  record: ExpenseRecord
): Promise<number> {
  const { sheets, spreadsheetId, tabName } = await ensureMonthSheetReady(
    monthIndex,
    year
  );

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:G`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          record.id,
          record.amount,
          record.description,
          record.category,
          record.date,
          record.telegramUserId,
          record.createdAt,
        ],
      ],
    },
  });

  return adjustSaldo(monthIndex, year, -record.amount);
}

/** Retorna todos os gastos registrados na aba de um mês específico. */
export async function getMonthExpenses(
  monthIndex: number,
  year: number
): Promise<ExpenseRecord[]> {
  const { sheets, spreadsheetId, tabName } = await ensureMonthSheetReady(
    monthIndex,
    year
  );

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A2:G`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rows = (res.data.values ?? []) as Array<Array<string | number>>;
  return rows.map(rowToExpense).filter((e): e is ExpenseRecord => e !== null);
}

/**
 * Apaga fisicamente a última linha de gasto da aba do mês (usado pelo
 * /desfazer) e DEVOLVE o valor ao saldo mensal (soma de volta em I1).
 */
export async function deleteLastExpense(
  monthIndex: number,
  year: number
): Promise<ExpenseRecord | null> {
  const { sheets, spreadsheetId, sheetId, tabName } =
    await ensureMonthSheetReady(monthIndex, year);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A2:G`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rows = (res.data.values ?? []) as Array<Array<string | number>>;
  if (rows.length === 0) return null;

  const lastIndex = rows.length - 1;
  const removed = rowToExpense(rows[lastIndex]);

  // Linha real na planilha (0-based): o cabeçalho ocupa o índice 0,
  // então os dados começam no índice 1.
  const sheetRowStart = lastIndex + 1;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: sheetRowStart,
              endIndex: sheetRowStart + 1,
            },
          },
        },
      ],
    },
  });

  if (removed) {
    await adjustSaldo(monthIndex, year, removed.amount);
  }

  return removed;
}

/** Lê o saldo mensal disponível (I1) da aba de um mês. */
export async function getSaldoMensal(
  monthIndex: number,
  year: number
): Promise<number> {
  const { sheets, spreadsheetId, tabName } = await ensureMonthSheetReady(
    monthIndex,
    year
  );
  return readSaldo(sheets, spreadsheetId, tabName);
}

/** Soma um salário ao saldo mensal (I1) do mês informado. Retorna o novo saldo. */
export async function addSalario(
  monthIndex: number,
  year: number,
  value: number
): Promise<number> {
  return adjustSaldo(monthIndex, year, value);
}

/** Soma um valor extra ao saldo mensal (I1) do mês informado. Retorna o novo saldo. */
export async function addExtra(
  monthIndex: number,
  year: number,
  value: number
): Promise<number> {
  return adjustSaldo(monthIndex, year, value);
}

// --- Estado de conversa (fluxo /adicionar-salario e /adicionar-extra) ---
//
// Como o webhook é stateless entre requisições, guardamos "o bot está
// esperando um valor de X do usuário Y" numa aba dedicada ("Estado") na
// própria planilha, em vez de em memória (que não sobrevive entre
// invocações serverless) ou em um banco à parte.

async function findStateRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  telegramUserId: string
): Promise<{ rowIndex: number; rows: Array<Array<string | number>> }> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!A2:C`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rows = (res.data.values ?? []) as Array<Array<string | number>>;
  const rowIndex = rows.findIndex((r) => String(r[0]) === telegramUserId);
  return { rowIndex, rows };
}

export async function getPendingAction(
  telegramUserId: string
): Promise<PendingAction | null> {
  const { sheets, spreadsheetId, title } = await ensureStateSheetReady();
  const { rowIndex, rows } = await findStateRow(
    sheets,
    spreadsheetId,
    title,
    telegramUserId
  );

  if (rowIndex === -1) return null;
  const action = rows[rowIndex]?.[1];
  return action === "salario" || action === "extra" ? action : null;
}

export async function setPendingAction(
  telegramUserId: string,
  action: PendingAction
): Promise<void> {
  const { sheets, spreadsheetId, title } = await ensureStateSheetReady();
  const { rowIndex } = await findStateRow(
    sheets,
    spreadsheetId,
    title,
    telegramUserId
  );

  const now = new Date().toISOString();

  if (rowIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${title}!A:C`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[telegramUserId, action, now]] },
    });
  } else {
    const sheetRow = rowIndex + 2; // +1 cabeçalho, +1 (0-based -> 1-based)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!B${sheetRow}:C${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[action, now]] },
    });
  }
}

export async function clearPendingAction(telegramUserId: string): Promise<void> {
  const { sheets, spreadsheetId, title } = await ensureStateSheetReady();
  const { rowIndex } = await findStateRow(
    sheets,
    spreadsheetId,
    title,
    telegramUserId
  );

  if (rowIndex === -1) return;

  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!B${sheetRow}:C${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [["", new Date().toISOString()]] },
  });
}
