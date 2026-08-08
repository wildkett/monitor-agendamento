import { chromium } from "playwright";
import { carregarConfig } from "./config.js";
import {
  login,
  listarEncaminhamentos,
  agendarPeloModal,
  fecharModal,
} from "./login.js";
import {
  verificarEspecialidade,
  buscarHorarios,
  naGradeDeDatas,
} from "./verificarEspecialidade.js";
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
    let primeiraVolta = true;

    for (const especialidadeConfig of config.especialidades) {
      const { nome } = especialidadeConfig;

      try {
        // Cada especialidade recomeça do login. A tela da agenda só oferece
        // "Voltar para a tela inicial", que devolve ao formulário de matrícula
        // e encerra a sessão — não há caminho de volta para o dropdown.
        await login(page, config);

        // O modal traz encaminhamentos e retornos. O login o deixa aberto de
        // propósito, porque parte dessas especialidades não existe no dropdown.
        const encaminhamentos = await listarEncaminhamentos(page);
        if (primeiraVolta) {
          console.log(
            encaminhamentos.length > 0
              ? `Encaminhamentos/retornos no modal: ${encaminhamentos.join(", ")}`
              : "Nenhum encaminhamento pendente no modal."
          );
          primeiraVolta = false;
        }

        console.log(
          `Verificando: ${nome} (${especialidadeConfig.dataInicio} a ${especialidadeConfig.dataFim})`
        );

        // Estar no modal não implica estar fora do dropdown: CARDIOLOGIA, por
        // exemplo, aparece nos dois. O dropdown é a busca geral e tem
        // preferência; o modal atende só o retorno com um médico específico.
        let vagas;
        await fecharModal(page);

        try {
          vagas = await verificarEspecialidade(page, especialidadeConfig, { viaModal: false });
        } catch (erro) {
          if (erro.code !== "NAO_NO_DROPDOWN" || !encaminhamentos.includes(nome)) throw erro;

          // Só existe pelo modal — e ele já foi fechado, então refaz o login
          // para reabri-lo.
          console.log("  (não está no dropdown; usando o encaminhamento)");
          await login(page, config);
          await agendarPeloModal(page, nome);
          vagas = await verificarEspecialidade(page, especialidadeConfig, { viaModal: true });
        }
        const vagasNovas = filtrarNovas(estado, nome, vagas);

        console.log(`  -> ${vagas.length} vaga(s) no período, ${vagasNovas.length} nova(s)`);

        // Só as vagas novas ganham horário: cada uma custa entrar na unidade e
        // voltar. As já conhecidas não precisam ser revisitadas a cada ciclo.
        let comHorario = 0;
        for (const vaga of vagasNovas) {
          const horarios = await buscarHorarios(page, vaga).catch((erro) => {
            console.log(`  (sem horário para ${vaga.data}: ${erro.message})`);
            return [];
          });

          if (horarios.length > 0) {
            vaga.hora = horarios.join(", ");
            comHorario++;
            console.log(`  ${vaga.data}: ${vaga.hora}`);
          } else {
            console.log(`  ${vaga.data}: nenhum horário lido na tela da unidade`);
          }

          // Sem conseguir voltar à grade, as próximas buscas só produziriam a
          // mesma falha repetida. Melhor parar e alertar com o que já se tem.
          if (!(await naGradeDeDatas(page))) {
            console.log("  (preso fora da grade; as vagas restantes vão sem horário)");
            break;
          }
        }

        if (vagasNovas.length > 0) {
          console.log(`  -> ${comHorario} de ${vagasNovas.length} vaga(s) com horário`);
        }

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
