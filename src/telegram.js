// Copyright (c) 2026 Kettly Lima
// SPDX-License-Identifier: MIT

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

// A mensagem vai com parse_mode HTML e boa parte do texto vem lido do site. Um
// "<" ou "&" no nome de uma unidade faria o Telegram recusar a mensagem inteira,
// e o alerta da vaga se perderia.
function escaparHtml(texto) {
  return String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatarMensagemVaga({ especialidade, vagas, urlAgenda }) {
  const linhas = vagas
    .map((v) => {
      const [ano, mes, dia] = v.data.split("-");
      const quando = v.hora ? `${dia}/${mes} às ${v.hora}` : `${dia}/${mes}/${ano}`;
      const local = v.profissional ?? "local não informado";
      return `• <b>${escaparHtml(quando)}</b>\n  ${escaparHtml(local)}`;
    })
    .join("\n");

  return (
    `🩺 <b>OLHA A VAAAGAAA: ${escaparHtml(especialidade)}</b>\n\n` +
    `${linhas}\n\n` +
    `CLICA AÍ E AGENDA LOGO: ${escaparHtml(urlAgenda)}`
  );
}
