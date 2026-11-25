// Copyright (c) 2026 Kettly Lima
// SPDX-License-Identifier: MIT

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
import { capturarTelaSemDados } from "./screenshot.js";
import { carregarEstado, salvarEstado, filtrarNovas, atualizarEstado } from "./state.js";

async function main() {
  const config = carregarConfig();
  const estado = carregarEstado();

  // HEADLESS=false abre o navegador na tela, em câmera lenta, pra acompanhar
  const visivel = (process.env.HEADLESS ?? "").trim() === "false";
  const browser = await chromium.launch({
    headless: !visivel,
    slowMo: visivel ? 500 : 0,
  });
  const page = await browser.newPage();

  // O nome da especialidade não vai pro log, que é público. O mascaramento de
  // secrets esconde o ESPECIALIDADES inteiro, mas não cada nome isolado.
  // Com DEBUG_VAGAS (uso local) o nome aparece.
  const detalhado = Boolean(process.env.DEBUG_VAGAS);
  const total = config.especialidades.length;

  try {
    let primeiraVolta = true;

    for (const [indice, especialidadeConfig] of config.especialidades.entries()) {
      const { nome } = especialidadeConfig;
      const rotulo = detalhado ? `"${nome}"` : `especialidade ${indice + 1} de ${total}`;

      try {
        // Cada especialidade recomeça do login: da agenda não há caminho de
        // volta pro dropdown, só pra tela inicial, que derruba a sessão.
        await login(page, config);

        // O login deixa o modal aberto de propósito: parte das especialidades
        // não aparece no dropdown, só aqui dentro.
        const encaminhamentos = await listarEncaminhamentos(page);
        if (primeiraVolta) {
          if (encaminhamentos.length === 0) {
            console.log("Nenhum encaminhamento pendente no modal.");
          } else if (detalhado) {
            console.log(`Encaminhamentos/retornos no modal: ${encaminhamentos.join(", ")}`);
          } else {
            console.log(`${encaminhamentos.length} encaminhamento(s)/retorno(s) no modal.`);
          }
          primeiraVolta = false;
        }

        console.log(
          `Verificando ${rotulo} (${especialidadeConfig.dataInicio} a ${especialidadeConfig.dataFim})`
        );

        // Uma especialidade pode estar no modal e no dropdown ao mesmo tempo. O
        // dropdown é a busca geral e tem preferência; o modal é retorno com um
        // médico específico.
        let vagas;
        await fecharModal(page);

        try {
          vagas = await verificarEspecialidade(page, especialidadeConfig, { viaModal: false });
        } catch (erro) {
          if (erro.code !== "NAO_NO_DROPDOWN" || !encaminhamentos.includes(nome)) throw erro;

          // Existe só pelo modal, e eu acabei de fechar ele. Refaz o login.
          console.log("  (não está no dropdown; usando o encaminhamento)");
          await login(page, config);
          await agendarPeloModal(page, nome);
          vagas = await verificarEspecialidade(page, especialidadeConfig, { viaModal: true });
        }

        const vagasNovas = filtrarNovas(estado, nome, vagas, config.stateKey);
        console.log(`  -> ${vagas.length} vaga(s) no período, ${vagasNovas.length} nova(s)`);

        // Só as novas ganham horário: cada uma custa entrar na unidade e voltar.
        // Revisitar as já conhecidas a cada 20 minutos seria carga à toa no site.
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

          // Se não dá pra voltar pra grade, as próximas buscas só repetiriam a
          // mesma falha. Melhor parar e avisar com o que já tem.
          if (!(await naGradeDeDatas(page))) {
            console.log("  (preso fora da grade; as vagas restantes vão sem horário)");
            break;
          }
        }

        if (vagasNovas.length > 0) {
          console.log(`  -> ${comHorario} de ${vagasNovas.length} vaga(s) com horário`);

          if (config.semAlerta) {
            console.log(`  (SEM_ALERTA: ${vagasNovas.length} vaga(s) registrada(s) sem avisar)`);
          } else {
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
        }

        atualizarEstado(estado, nome, vagas, config.stateKey);
      } catch (erroEspecialidade) {
        console.error(`Erro ao verificar ${rotulo}:`, erroEspecialidade.message);
        if (detalhado) console.error(`  URL no momento do erro: ${page.url()}`);
        const arquivo = detalhado ? nome.replace(/\W+/g, "-") : `especialidade-${indice + 1}`;
        await capturarTelaSemDados(page, `erro-${arquivo}.png`);
        // Segue pras próximas especialidades mesmo que esta tenha falhado
      }
    }

    salvarEstado(estado);
  } catch (erro) {
    console.error("Erro no fluxo de monitoramento:", erro.message);
    await capturarTelaSemDados(page, "erro-debug.png");
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
