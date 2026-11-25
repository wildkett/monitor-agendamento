// Copyright (c) 2026 Kettly Lima
// SPDX-License-Identifier: MIT

// "Segunda-feira , 10 de Agosto de 2026". O mês vem por extenso e pode ter
// acento (Março), por isso [a-zA-ZçÇãÃ]+ em vez de \w+.
const REGEX_DATA = /(\d{1,2}) de ([a-zA-ZçÇãÃ]+) de (\d{4})/;

// Nome de especialidade e de unidade só entram nas mensagens com DEBUG_VAGAS
// (uso local). O log do Actions é público.
const DETALHADO = Boolean(process.env.DEBUG_VAGAS);

/**
 * @param {object} opcoes
 * @param {boolean} opcoes.viaModal a especialidade já foi escolhida pelo botão
 *   "Agendar" do modal, então não passa pelo dropdown. Só falta avançar.
 */
export async function verificarEspecialidade(page, especialidadeConfig, opcoes = {}) {
  const { nome, dataInicio, dataFim } = especialidadeConfig;
  const { viaModal = false } = opcoes;

  await page.waitForLoadState('networkidle');

  if (!viaModal) {
    // Exata primeiro: por padrão o Playwright casa por trecho, e "CARDIOLOGIA"
    // bateria também em "CARDIOLOGIA PEDIATRICA". Casar com duas faz o strict
    // mode recusar o clique e a especialidade parecer ausente.
    const exata = page.getByRole('option', { name: nome, exact: true });
    const parcial = page.getByRole('option', { name: nome });

    await page.locator('[id="frmInicial:group"]').getByRole('button').click();
    let opcao = (await visivelEm(exata, 4000)) ? exata : null;

    if (!opcao) {
      // O campo é um autocomplete. Com a lista grande, nem todo item fica
      // acessível só abrindo o dropdown; digitar filtra e traz o item.
      const entrada = page.locator('[id="frmInicial:group_input"]');
      await entrada.click();
      await entrada.fill('');
      await entrada.pressSequentially(nome, { delay: 30 });

      if (await visivelEm(exata, 6000)) opcao = exata;
      else if (await visivelEm(parcial, 2000)) opcao = parcial;
    }

    if (!opcao) {
      // Não achar é resposta esperada, não erro: a especialidade pode estar só
      // no modal (o index.js tenta por lá) ou não ser oferecida.
      const erro = new Error(
        DETALHADO ? `"${nome}" não está na lista do dropdown.` : "não está na lista do dropdown."
      );
      erro.code = 'NAO_NO_DROPDOWN';
      throw erro;
    }

    await opcao.first().click();
  }

  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.waitForLoadState('networkidle');

  // A grade chega por AJAX, às vezes depois do networkidle. Sem esperar por ela,
  // a página seria lida vazia e daria "nenhuma vaga" por engano.
  const grade = page.locator('[id="frmInicial:pnlUniDatas_content"]').first();
  const temGrade = await grade
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!temGrade) {
    // Sem grade: ou não tem agenda, ou o "Avançar" não saiu do lugar. O segundo
    // caso é erro, não "nenhuma vaga".
    const aindaNaSelecao = await page
      .locator('[id="frmInicial:group"]')
      .isVisible()
      .catch(() => false);

    if (aindaNaSelecao) {
      throw new Error(
        `o "Avançar" não levou à agenda${DETALHADO ? ` de "${nome}"` : ""}: a tela ` +
          `continua na seleção de especialidade.`
      );
    }

    console.log(`  -> Nenhuma agenda disponível${DETALHADO ? ` para ${nome}` : ""}`);
    return [];
  }

  const vagasNoPeriodo = [];
  const jaVistas = new Set();

  // Cada linha traz a data e, abaixo, as unidades:
  //   "Segunda-feira , 10 de Agosto de 2026\n\nUNIDADE CENTRO\nRUA X, 220"
  // Leio o innerText inteiro: os <tr> são aninhados e sem estrutura uniforme.
  const linhas = await page.locator('tr').all();

  for (const linha of linhas) {
    let texto;
    try {
      texto = await linha.innerText();
    } catch {
      continue; // a linha sumiu do DOM entre o .all() e a leitura
    }

    if (!texto) continue;

    const partes = texto
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const matchData = partes[0]?.match(REGEX_DATA);
    if (!matchData) continue;

    const [, dia, mesNome, ano] = matchData;
    const data = `${ano}-${converterMesParaNumero(mesNome)}-${dia.padStart(2, '0')}`;

    if (data < dataInicio || data > dataFim) continue;

    // Depois da data vêm pares de linhas: nome da unidade e endereço. Uma linha
    // "pai" pode englobar várias datas, então corto onde aparece a próxima data,
    // senão ela seria lida como nome de unidade.
    let resto = partes.slice(1);
    const proximaData = resto.findIndex((l) => REGEX_DATA.test(l));
    if (proximaData !== -1) resto = resto.slice(0, proximaData);

    resto = resto.filter((l) => !/Nenhum Profissional/i.test(l));
    if (resto.length === 0) continue; // dia sem vaga

    for (let i = 0; i < resto.length; i += 2) {
      const unidade = resto[i];
      const endereco = resto[i + 1] ?? '';
      const local = endereco ? `${unidade} — ${endereco}` : unidade;

      const chave = `${data}|${local}`;
      if (jaVistas.has(chave)) continue; // <tr> aninhados repetem o mesmo conteúdo
      jaVistas.add(chave);

      vagasNoPeriodo.push({ data, hora: undefined, profissional: local });
    }
  }

  if (process.env.DEBUG_VAGAS) {
    console.log(`  [debug] ${linhas.length} linha(s) na tabela, ${vagasNoPeriodo.length} no período`);
  }

  return vagasNoPeriodo;
}

/**
 * Entra na unidade da vaga e lê os horários livres. A grade de datas não tem
 * hora: ela só aparece na tela da unidade. Precisa ser chamada com a página na
 * grade de datas.
 *
 * @returns {Promise<string[]>} horários no formato "07:30"
 */
export async function buscarHorarios(page, vaga) {
  // O link traz só o nome da unidade, sem o endereço depois do travessão.
  const unidade = vaga.profissional.split(' — ')[0].trim();

  const linhaDaData = page
    .locator('tr')
    .filter({ hasText: new RegExp(escaparRegex(formatarDataExtenso(vaga.data))) })
    .first();

  const link = linhaDaData
    .getByRole('link', { name: new RegExp(escaparRegex(unidade)) })
    .first();

  if ((await link.count()) === 0) {
    throw new Error(
      `link da unidade${DETALHADO ? ` "${unidade}"` : ""} não encontrado na linha ` +
        `de ${vaga.data} (grade visível: ${await naGradeDeDatas(page)})`
    );
  }

  await link.click();
  await page.waitForLoadState('networkidle');

  // Os horários são botões com rótulo "HH:MM". Espero por eles porque o
  // networkidle às vezes dispara antes de renderizarem.
  const botoesHorario = page.getByRole('button', { name: /^\d{1,2}:\d{2}$/ });
  await botoesHorario
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {}); // pode não ter horário livre mesmo

  const horarios = (await botoesHorario.allInnerTexts()).map((t) => t.trim());

  // Falha ao voltar não descarta os horários lidos. O index.js percebe pelo
  // naGradeDeDatas e para de buscar as próximas.
  await voltarParaGrade(page).catch((erro) => {
    console.log(`  (falha ao voltar: ${erro.message})`);
  });

  return [...new Set(horarios)].sort();
}

/** Da tela de horários de volta pra grade de datas. */
async function voltarParaGrade(page) {
  // Nome completo de propósito: "Voltar para a tela inicial" fica na mesma tela
  // e derruba a sessão.
  const voltar = page.getByRole('link', { name: 'Voltar para a tela anterior' });
  const quantos = await voltar.count().catch(() => 0);

  if (quantos > 0) {
    await voltar.first().click({ timeout: 10000 }).catch(() => {});

    // O link troca o painel por AJAX, depois do networkidle. Espero a grade
    // reaparecer.
    const voltou = await page
      .getByRole('link', { name: /Botão de Seleção de Unidade/ })
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (voltou) return;
  }

  throw new Error(
    `não voltou para a grade (links "Voltar para a tela anterior": ${quantos}` +
      `${DETALHADO ? `, url: ${page.url()}` : ""})`
  );
}

/** A grade mostra a data por extenso: "2026-08-29" vira "29 de Agosto de 2026". */
function formatarDataExtenso(data) {
  const [ano, mes, dia] = data.split('-');
  const nomes = {
    '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
    '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
    '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro',
  };
  return `${dia} de ${nomes[mes]} de ${ano}`;
}

function visivelEm(locator, timeout) {
  return locator
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A grade continua acessível? Uso pra saber se o "Voltar" funcionou. */
export async function naGradeDeDatas(page) {
  // Pelos links de unidade, não pelo id do container: o JSF gera ids
  // diferentes conforme o fluxo.
  const links = page.getByRole('link', { name: /Botão de Seleção de Unidade/ });
  return (await links.count().catch(() => 0)) > 0;
}

function converterMesParaNumero(mesNome) {
  const meses = {
    'Janeiro': '01', 'Fevereiro': '02', 'Março': '03', 'Abril': '04',
    'Maio': '05', 'Junho': '06', 'Julho': '07', 'Agosto': '08',
    'Setembro': '09', 'Outubro': '10', 'Novembro': '11', 'Dezembro': '12',
  };
  return meses[mesNome] || '01';
}
