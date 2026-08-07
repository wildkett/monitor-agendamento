import { chromium } from "playwright";
import { carregarConfig } from "./config.js";
import { login } from "./login.js";
import { verificarEspecialidade } from "./verificarEspecialidade.js";
import { enviarAlertaTelegram, formatarMensagemVaga } from "./telegram.js";
import { carregarEstado, salvarEstado, filtrarNovas, atualizarEstado } from "./state.js";

async function main() {
  const config = carregarConfig();
  const estado = carregarEstado();

  // HEADLESS=false abre o navegador na tela — útil pra depurar o fluxo
  const visivel = (process.env.HEADLESS ?? "").trim() === "false";
  const browser = await chromium.launch({
    headless: !visivel,
    slowMo: visivel ? 500 : 0,
  });
  const page = await browser.newPage();

  try {
    await login(page, config);

    for (const especialidadeConfig of config.especialidades) {
      const { nome } = especialidadeConfig;
      console.log(`Verificando: ${nome} (${especialidadeConfig.dataInicio} a ${especialidadeConfig.dataFim})`);

      try {
        const vagas = await verificarEspecialidade(page, especialidadeConfig);
        const vagasNovas = filtrarNovas(estado, nome, vagas);

        console.log(`  -> ${vagas.length} vaga(s) no período, ${vagasNovas.length} nova(s)`);

        if (vagasNovas.length > 0) {
          const mensagem = formatarMensagemVaga({
            especialidade: nome,
            vagas: vagasNovas,
            urlAgenda: config.agendaUrl,
          });
          await enviarAlertaTelegram({
            botToken: config.telegramBotToken,
            chatId: config.telegramChatId,
            mensagem,
          });
        }

        atualizarEstado(estado, nome, vagas);
      } catch (erroEspecialidade) {
        console.error(`Erro ao verificar "${nome}":`, erroEspecialidade.message);
        console.error(`  URL no momento do erro: ${page.url()}`);
        await page
          .screenshot({ path: `erro-${nome.replace(/\W+/g, "-")}.png`, fullPage: true })
          .catch(() => {});
        // Continua para as próximas especialidades mesmo se uma falhar
      }
    }

    salvarEstado(estado);
  } catch (erro) {
    console.error("Erro no fluxo de monitoramento:", erro.message);
    // Screenshot ajuda a debugar quando o site muda ou algo quebra
    await page.screenshot({ path: "erro-debug.png", fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
