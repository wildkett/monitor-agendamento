export async function enviarAlertaTelegram({ botToken, chatId, mensagem }) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const resposta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: mensagem,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`Falha ao enviar mensagem no Telegram: ${corpo}`);
  }
}

export function formatarMensagemVaga({ especialidade, vagas, urlAgenda }) {
  const linhas = vagas
    .map((v) => `• ${v.data} às ${v.hora} — ${v.profissional ?? "profissional não informado"}`)
    .join("\n");

  return (
    `🩺 <b>Vaga encontrada: ${especialidade}</b>\n\n` +
    `${linhas}\n\n` +
    `Agende rápido, pode sumir: ${urlAgenda}`
  );
}
