// "Segunda-feira , 10 de Agosto de 2026". O mês vem por extenso e pode ter
// acento (Março), por isso [a-zA-ZçÇãÃ]+ em vez de \w+.
const REGEX_DATA = /(\d{1,2}) de ([a-zA-ZçÇãÃ]+) de (\d{4})/;

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
    // Tento a correspondência exata primeiro. O Playwright casa por trecho por
    // padrão, então "CARDIOLOGIA" bateria também em "CARDIOLOGIA PEDIATRICA".
    // Além de poder clicar na opção errada, casar com duas faz o strict mode
    // recusar a ação, e era assim que uma especialidade que existia na lista
    // acabava reportada como ausente.
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
      const erro = new Error(`"${nome}" não está na lista do dropdown.`);
      erro.code = 'NAO_NO_DROPDOWN';
      throw erro;
    }

    await opcao.first().click();
  }

  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.waitForLoadState('networkidle');

  // A grade de datas chega por AJAX e o networkidle às vezes dispara antes dela
  // renderizar. Esperar o container evita ler a página vazia e concluir errado
  // que não tem vaga nenhuma.
  const grade = page.locator('[id="frmInicial:pnlUniDatas_content"]').first();
  const temGrade = await grade
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!temGrade) {
    // Sem a grade são dois casos bem diferentes: ou não tem agenda pra essa
    // especialidade, ou o "Avançar" não saiu do lugar. Separar os dois evita
    // registrar "nenhuma vaga" quando na verdade o fluxo travou.
    const aindaNaSelecao = await page
      .locator('[id="frmInicial:group"]')
      .isVisible()
      .catch(() => false);

    if (aindaNaSelecao) {
      throw new Error(
        `O "Avançar" não levou à agenda de "${nome}": a tela continua na ` +
          `seleção de especialidade.`
      );
    }

    console.log(`  -> Nenhuma agenda disponível para ${nome}`);
    return [];
  }

  const vagasNoPeriodo = [];
  const jaVistas = new Set();

  // Cada linha traz a data e, abaixo, as unidades:
  //   "Segunda-feira , 10 de Agosto de 2026\n\nUNIDADE CENTRO\nRUA X, 220"
  // Ler o innerText inteiro saiu mais estável do que caçar span por span,
  // porque a página tem dezenas de <tr> aninhados e sem estrutura uniforme.
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

  // Não uso o "Voltar para a tela inicial" aqui: ele devolve pro formulário de
  // matrícula e encerra a sessão. Quem chama refaz o login pra próxima.
  return vagasNoPeriodo;
}

/**
 * Entra na unidade da vaga e lê os horários livres.
 *
 * O horário não existe na grade de datas: o link da unidade carrega só
 * `wr('44,1625,2026-08-10')`, sem hora. Ele aparece na tela seguinte, em botões
 * tipo `whrora('36,127546,2026-08-29,07:30')`. Por isso só busco pras vagas
 * novas, varrer as 30 conhecidas a cada ciclo seria carga à toa.
 *
 * Precisa ser chamada com a página ainda na grade de datas.
 *
 * @returns {Promise<string[]>} horários no formato "07:30", ou [] se não deu
 *   pra abrir a unidade (o alerta vai sem horário em vez de falhar).
 */
export async function buscarHorarios(page, vaga) {
  // vaga.profissional é "UNIDADE CENTRO — RUA X, 220", mas o link traz só o
  // nome da unidade, antes do travessão.
  const unidade = vaga.profissional.split(' — ')[0].trim();

  const linhaDaData = page
    .locator('tr')
    .filter({ hasText: new RegExp(escaparRegex(formatarDataExtenso(vaga.data))) })
    .first();

  const link = linhaDaData
    .getByRole('link', { name: new RegExp(escaparRegex(unidade)) })
    .first();

  if ((await link.count()) === 0) {
    // Mensagem detalhada de propósito: é a única pista de por que a busca não
    // aconteceu, e separa "a grade sumiu" de "o link mudou".
    throw new Error(
      `link da unidade "${unidade}" não encontrado na linha de ${vaga.data} ` +
        `(grade visível: ${await naGradeDeDatas(page)}, url: ${page.url()})`
    );
  }

  await link.click();
  await page.waitForLoadState('networkidle');

  // Os horários são botões cujo rótulo é só "HH:MM". Mirar direto neles em vez
  // de varrer todos os botões me deixa esperar a renderização, porque o
  // networkidle às vezes dispara antes da grade de horários existir.
  const botoesHorario = page.getByRole('button', { name: /^\d{1,2}:\d{2}$/ });
  await botoesHorario
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {}); // pode não ter horário livre mesmo

  const horarios = (await botoesHorario.allInnerTexts()).map((t) => t.trim());

  // Só tento voltar depois de já ter os horários na mão, e sem propagar o erro:
  // se o retorno falhar, o que foi lido continua valendo. O index.js percebe a
  // falha pelo naGradeDeDatas e para de buscar as próximas.
  await voltarParaGrade(page).catch((erro) => {
    console.log(`  (falha ao voltar: ${erro.message})`);
  });

  return [...new Set(horarios)].sort();
}

/** Da tela de horários de volta pra grade de datas. */
async function voltarParaGrade(page) {
  // O rótulo é "Voltar para a tela ANTERIOR", perigosamente parecido com
  // "Voltar para a tela INICIAL", que reinicia a sessão e derruba o login. Por
  // isso o nome vai completo: um "Voltar" solto casaria com os dois.
  const voltar = page.getByRole('link', { name: 'Voltar para a tela anterior' });
  const quantos = await voltar.count().catch(() => 0);

  if (quantos > 0) {
    await voltar.first().click({ timeout: 10000 }).catch(() => {});

    // É um ui-commandlink: dispara AJAX e troca o painel sem recarregar a
    // página. O networkidle termina antes disso, então espero a grade
    // reaparecer em vez de conferir na hora.
    const voltou = await page
      .getByRole('link', { name: /Botão de Seleção de Unidade/ })
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (voltou) return;
  }

  throw new Error(
    `não voltou para a grade (links "Voltar para a tela anterior": ${quantos}, ` +
      `url: ${page.url()})`
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
  // Identifico a grade pelos links de unidade e não pelo id do container: os
  // ids são gerados pelo JSF e mudam conforme o fluxo (pnlUniDatas_content num
  // caso, j_idt100:0:dtgrd_content noutro). Os links estão sempre lá.
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
