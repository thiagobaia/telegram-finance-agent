import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { extractExpenseFromText } from "@/lib/agent";
import {
  handleAjuda,
  handleCancelar,
  handleCategorias,
  handleCategoriasMes,
  handleDesfazer,
  handleDetalheMes,
  handleDivisao,
  handleDivisaoMes,
  handleHoje,
  handleIniciarAdicionar,
  handleResumo,
  handleResumoDia,
  handleSaldo,
  handleValorPendente,
} from "@/lib/commands";
import { monthInfoFromDate } from "@/lib/months";
import { appendExpense, getPendingAction } from "@/lib/sheets";
import { sendTelegramMessage } from "@/lib/telegram";

// Garante que a rota nunca seja cacheada estaticamente pelo Next.js.
export const dynamic = "force-dynamic";

interface TelegramUpdate {
  message?: {
    message_id: number;
    text?: string;
    from?: {
      id: number;
      first_name?: string;
      username?: string;
    };
    chat: {
      id: number;
    };
  };
}

function getAllowedIds(): string[] {
  const raw = process.env.ALLOWED_TELEGRAM_IDS ?? "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Trata mensagens que começam com "/". Executa a consulta correspondente
 * direto no Google Sheets e responde ao usuário, SEM acionar o LLM.
 *
 * Comandos como /resumo-outubro, /categorias-outubro e /divisao-outubro
 * são resolvidos dinamicamente: tudo que vier depois do primeiro "-" é
 * tratado como o nome do mês (parseMonthSlug faz esse parse em months.ts).
 */
async function handleCommand(
  text: string,
  chatId: number,
  telegramUserId: string
): Promise<void> {
  const [rawCommand] = text.split(/\s+/);
  // Remove possível sufixo "@nomedobot" que o Telegram adiciona em grupos.
  const command = rawCommand.toLowerCase().split("@")[0];
  // Tudo que vier depois do comando (ex: o valor em "/adicionar-salario 3500").
  const remainder = text.slice(rawCommand.length).trim();

  try {
    let reply: string;

    switch (command) {
      case "/resumo":
        reply = await handleResumo();
        break;

      case "/resumo-dia":
        reply = await handleResumoDia();
        break;

      case "/categorias":
        reply = await handleCategorias();
        break;

      case "/hoje":
        reply = await handleHoje();
        break;

      case "/desfazer":
        reply = await handleDesfazer();
        break;

      case "/divisao":
        reply = await handleDivisao();
        break;

      case "/saldo":
        reply = await handleSaldo();
        break;

      case "/adicionar-salario":
        reply = await handleIniciarAdicionar(
          "salario",
          telegramUserId,
          remainder || undefined
        );
        break;

      case "/adicionar-extra":
        reply = await handleIniciarAdicionar(
          "extra",
          telegramUserId,
          remainder || undefined
        );
        break;

      case "/cancelar":
        reply = await handleCancelar(telegramUserId);
        break;

      case "/ajuda":
      case "/start":
        reply = handleAjuda();
        break;

      default: {
        // Comandos dinâmicos por mês: /resumo-outubro, /detalhe-outubro,
        // /categorias-outubro, /divisao-outubro, etc.
        const dashIndex = command.indexOf("-");
        const base = dashIndex > 0 ? command.slice(1, dashIndex) : null;
        const slug = dashIndex > 0 ? command.slice(dashIndex + 1) : null;

        if (base && slug && (base === "resumo" || base === "detalhe")) {
          reply = await handleDetalheMes(slug);
        } else if (base && slug && base === "categorias") {
          reply = await handleCategoriasMes(slug);
        } else if (base && slug && base === "divisao") {
          reply = await handleDivisaoMes(slug);
        } else {
          reply = `❓ Comando não reconhecido: ${command}\nDigite /ajuda para ver os comandos disponíveis.`;
        }
      }
    }

    await sendTelegramMessage(chatId, reply);
  } catch (error) {
    console.error(`[webhook] Erro ao executar o comando ${command}:`, error);
    await sendTelegramMessage(
      chatId,
      "⚠️ Ocorreu um erro ao processar esse comando. Tente novamente em instantes."
    );
  }
}

export async function POST(req: NextRequest) {
  let update: TelegramUpdate;

  try {
    update = await req.json();
  } catch (error) {
    console.error("[webhook] Payload inválido recebido do Telegram:", error);
    // Retorna 200 mesmo assim para o Telegram não ficar reenviando o update.
    return NextResponse.json({ ok: true });
  }

  const message = update.message;

  // Ignora updates que não sejam mensagens de texto (edições, stickers, etc.)
  if (!message?.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  const chatId = message.chat.id;
  const fromId = message.from?.id;
  const text = message.text?.trim();

  // 1. Verifica se o usuário está na allowlist
  const allowedIds = getAllowedIds();
  if (!fromId || !allowedIds.includes(String(fromId))) {
    await sendTelegramMessage(
      chatId,
      "⛔ Acesso negado. Você não tem permissão para usar este bot."
    );
    return NextResponse.json({ ok: true });
  }

  const telegramUserId = String(fromId);

  // 2. Ignora mensagens vazias (ex: fotos, comandos sem texto, etc.)
  if (!text) {
    return NextResponse.json({ ok: true });
  }

  // 3. Comandos ("/algo") são tratados diretamente no Google Sheets
  //    e NUNCA acionam o LLM.
  if (text.startsWith("/")) {
    await handleCommand(text, chatId, telegramUserId);
    return NextResponse.json({ ok: true });
  }

  // 4. Se o usuário estiver no meio do fluxo /adicionar-salario ou
  //    /adicionar-extra (aguardando o valor), essa mensagem é a resposta
  //    a esse fluxo — trata aqui e NUNCA aciona o LLM para ela.
  try {
    const pendingAction = await getPendingAction(telegramUserId);
    if (pendingAction) {
      const reply = await handleValorPendente(pendingAction, telegramUserId, text);
      await sendTelegramMessage(chatId, reply);
      return NextResponse.json({ ok: true });
    }
  } catch (error) {
    console.error("[webhook] Erro ao verificar ação pendente:", error);
    // Segue o fluxo normal (extração via LLM) em caso de falha aqui.
  }

  try {
    // 5. Chama o LLM para extrair os dados estruturados (já validados via Zod dentro de extractExpenseFromText)
    const expense = await extractExpenseFromText(text);

    // 6. Persiste na aba do mês correspondente (ex: "setembro-2026") e
    //    subtrai o valor do saldo mensal (SALDO MENSAL) daquele mês.
    const expenseDate = new Date(expense.date);
    const monthIndex = expenseDate.getMonth();
    const year = expenseDate.getFullYear();
    const now = new Date().toISOString();

    const novoSaldo = await appendExpense(monthIndex, year, {
      id: randomUUID(),
      amount: expense.amount,
      description: expense.description,
      category: expense.category,
      date: expense.date,
      telegramUserId,
      createdAt: now,
    });

    // 7. Confirma para o usuário, já mostrando o saldo restante do mês
    const formattedAmount = expense.amount.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const formattedSaldo = novoSaldo.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const currentMonthLabel = monthInfoFromDate(expenseDate).label;

    await sendTelegramMessage(
      chatId,
      `✅ R$ ${formattedAmount} salvos em ${expense.category}\n📝 ${expense.description}\n💰 Saldo de ${currentMonthLabel}: R$ ${formattedSaldo}`
    );
  } catch (error) {
    console.error("[webhook] Erro ao processar a mensagem:", error);
    await sendTelegramMessage(
      chatId,
      '⚠️ Não consegui entender esse gasto. Tente descrever de forma mais clara, ex: "gastei 45 no ifood hoje".'
    );
  }

  // Sempre retorna 200 para o Telegram não reenviar o update.
  return NextResponse.json({ ok: true });
}
