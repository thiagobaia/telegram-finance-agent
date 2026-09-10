import { createGroq } from "@ai-sdk/groq";
import { generateObject } from "ai";
import { z } from "zod";

// Instancia o provider da Groq explicitamente com a chave GROQ_API_KEY
const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

export const ALLOWED_CATEGORIES = [
  "Alimentação",
  "Transporte",
  "Moradia",
  "Cartão de Crédito",
  "Lazer",
  "Assinaturas",
  "Saúde",
  "Educação",
  "Outros",
] as const;

/**
 * Schema de validação do gasto extraído pela IA.
 * - amount: número positivo (garante que não vêm valores negativos/zero/NaN)
 * - date: string ISO 8601 válida
 * - category: restrita ao enum de categorias permitidas
 */
export const ExpenseSchema = z.object({
  amount: z
    .number()
    .positive({ message: "O valor (amount) deve ser um número positivo." }),
  description: z
    .string()
    .min(1, { message: "A descrição não pode ser vazia." }),
  category: z.enum(ALLOWED_CATEGORIES, {
    errorMap: () => ({
      message: `A categoria deve ser uma das seguintes: ${ALLOWED_CATEGORIES.join(", ")}`,
    }),
  }),
  date: z
    .string()
    .datetime({ message: "A data deve estar em formato ISO 8601 válido." }),
});

export type ExpenseData = z.infer<typeof ExpenseSchema>;

function buildSystemPrompt(): string {
  const today = new Date().toISOString();

  return `Você é um assistente financeiro especializado em extrair dados estruturados de mensagens sobre gastos pessoais, escritas em português informal.

Sua ÚNICA tarefa é retornar um objeto JSON puro (sem markdown, sem crases, sem texto explicativo, sem comentários) com os seguintes campos:
- "amount": número (float) positivo representando o valor gasto.
- "description": string curta descrevendo o gasto (ex: "iFood", "Uber", "Aluguel").
- "category": uma das categorias EXATAS: ${ALLOWED_CATEGORIES.join(", ")}.
- "date": data do gasto no formato ISO 8601 (ex: "2026-09-08T00:00:00.000Z").

Regras:
1. Se a mensagem mencionar "hoje", "ontem" ou não mencionar data nenhuma, calcule a data com base em agora: ${today}.
2. Nunca invente valores. Se não houver um valor numérico claro na mensagem, use o valor mais plausível mencionado no texto.
3. Sempre escolha a categoria mais adequada dentre a lista permitida. Se não for possível classificar, use "Outros".
4. Responda APENAS com o objeto JSON. Nenhum texto antes ou depois.`;
}

/**
 * Chama o LLM (Llama 3.1 via Groq) para extrair os dados estruturados
 * do gasto a partir de um texto em linguagem natural, e valida o resultado
 * com o ExpenseSchema (Zod). generateObject já força e valida a saída JSON
 * contra o schema fornecido, lançando erro caso o modelo devolva algo inválido.
 */
export async function extractExpenseFromText(
  text: string,
): Promise<ExpenseData> {
  const { object } = await generateObject({
    model: groq("openai/gpt-oss-20b"),
    schema: ExpenseSchema,
    system: buildSystemPrompt(),
    prompt: text,
  });

  // Segunda camada de validação explícita, garantindo que nunca escapa
  // um objeto fora do contrato esperado para o restante da aplicação.
  return ExpenseSchema.parse(object);
}
