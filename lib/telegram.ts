const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function getTelegramApiUrl(method: string): string {
  if (!BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN não configurado. Verifique seu arquivo .env"
    );
  }
  return `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
}

/**
 * Envia uma mensagem de texto para um chat do Telegram.
 * Nunca lança exceção para não derrubar o fluxo principal do webhook;
 * apenas loga o erro em caso de falha de rede ou resposta não-ok.
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string
): Promise<void> {
  try {
    const res = await fetch(getTelegramApiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(
        `[telegram] Falha ao enviar mensagem (status ${res.status}):`,
        errorBody
      );
    }
  } catch (error) {
    console.error("[telegram] Erro de rede ao chamar a API do Telegram:", error);
  }
}
