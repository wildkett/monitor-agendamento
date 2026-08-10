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

  try {
    let primeiraVolta = true;

    for (const especialidadeConfig of config.especialidades) {
      const { nome } = especialidadeConfig;

      try {
        // Cada especialidade recomeça do login. Na tela da agenda só existe
        // "Voltar para a tela inicial", que derruba a sessão e volta pro
        // formulário de matrícula. Não tem caminho de volta pro dropdown.
        await login(page, config);

        // O login deixa o modal aberto de propósito: parte das especialidades
        // não aparece no dropdown, só aqui dentro.
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

        // Aparecer no modal não quer dizer que sumiu do dropdown: CARDIOLOGIA
        // está nos dois. O dropdown é a busca geral e tem preferência, o modal
        // é só retorno com um médico específico.
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

        const vagasNovas = filtrarNovas(estado, nome, vagas);
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
            // Com o state.json vazio, tudo que está aberto hoje conta como novo
            // e viraria uma enxurrada de mensagem. Aqui só registra.
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

        atualizarEstado(estado, nome, vagas);
      } catch (erroEspecialidade) {
        console.error(`Erro ao verificar "${nome}":`, erroEspecialidade.message);
        console.error(`  URL no momento do erro: ${page.url()}`);
        await capturarTelaSemDados(page, `erro-${nome.replace(/\W+/g, "-")}.png`);
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
