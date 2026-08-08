// "Segunda-feira , 10 de Agosto de 2026" — o mês vem por extenso e pode ter
// acento (Março), por isso [a-zA-ZçÇãÃ]+ no lugar de \w+.
const REGEX_DATA = /(\d{1,2}) de ([a-zA-ZçÇãÃ]+) de (\d{4})/;

/**
 * @param {object} opcoes
 * @param {boolean} opcoes.viaModal quando a especialidade veio de um
 *   encaminhamento/retorno, ela já foi escolhida pelo botão "Agendar" do modal
 *   e não aparece no dropdown — resta só avançar.
 */
export async function verificarEspecialidade(page, especialidadeConfig, opcoes = {}) {
  const { nome, dataInicio, dataFim } = especialidadeConfig;
  const { viaModal = false } = opcoes;

  await page.waitForLoadState('networkidle');

  if (!viaModal) {
    // Correspondência exata primeiro: por padrão o Playwright casa por trecho,
    // e "CARDIOLOGIA" bateria também em "CARDIOLOGIA PEDIATRICA". Além de
    // arriscar clicar na opção errada, o casamento múltiplo faz o Playwright
    // recusar a ação por strict mode — que é como uma especialidade presente
    // na lista acabava reportada como ausente.
    const exata = page.getByRole('option', { name: nome, exact: true });
    const parcial = page.getByRole('option', { name: nome });

    // Abrir a lista completa pelo botão resolve a maioria dos casos.
    await page.locator('[id="frmInicial:group"]').getByRole('button').click();
    let opcao = (await visivelEm(exata, 4000)) ? exata : null;

    if (!opcao) {
      // O campo é um autocomplete: com a lista longa, nem todo item fica
      // acessível só abrindo o dropdown. Digitar filtra e traz o item à tona.
      const entrada = page.locator('[id="frmInicial:group_input"]');
      await entrada.click();
      await entrada.fill('');
      await entrada.pressSequentially(nome, { delay: 30 });

      if (await visivelEm(exata, 6000)) opcao = exata;
      else if (await visivelEm(parcial, 2000)) opcao = parcial;
    }

    if (!opcao) {
      // Ausência é resposta esperada, não falha: a especialidade pode estar só
      // no modal (e quem chama tenta por lá) ou não ser oferecida.
      const erro = new Error(`"${nome}" não está na lista do dropdown.`);
      erro.code = 'NAO_NO_DROPDOWN';
      throw erro;
    }

    await opcao.first().click();
  }

  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.waitForLoadState('networkidle');

  // A grade de datas chega por AJAX e o networkidle às vezes dispara antes
  // dela renderizar. Esperar o container evita ler a página vazia e concluir,
  // errado, que não há vaga nenhuma.
  const grade = page.locator('[id="frmInicial:pnlUniDatas_content"]').first();
  const temGrade = await grade
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!temGrade) {
    // Sem a grade, há dois casos bem diferentes: ou o site não tem agenda para
    // essa especialidade, ou o "Avançar" não saiu do lugar. Distinguir evita
    // registrar "nenhuma vaga" quando na verdade o fluxo travou.
    const aindaNaSelecao = await page
      .locator('[id="frmInicial:group"]')
      .isVisible()
      .catch(() => false);

    if (aindaNaSelecao) {
      throw new Error(
        `O "Avançar" não levou à agenda de "${nome}" — a tela continua na ` +
          `seleção de especialidade.`
      );
    }

    console.log(`  -> Nenhuma agenda disponível para ${nome}`);
    return [];
  }

  const vagasNoPeriodo = [];
  const jaVistas = new Set();

  // Cada linha da tabela traz a data e, abaixo, as unidades disponíveis:
  //   "Segunda-feira , 10 de Agosto de 2026\n\nUNIDADE CENTRO\nRUA EXEMPLO, 100"
  // Ler o innerText inteiro é mais estável do que caçar span por span, porque
  // a página tem dezenas de <tr> aninhados e sem estrutura uniforme.
  const linhas = await page.locator('tr').all();

  for (const linha of linhas) {
    let texto;
    try {
      texto = await linha.innerText();
    } catch {
      continue; // linha sumiu do DOM entre o .all() e a leitura
    }

    if (!texto) continue;

    const partes = texto
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // "Segunda-feira , 10 de Agosto de 2026" → "2026-08-10"
    const matchData = partes[0]?.match(REGEX_DATA);
    if (!matchData) continue;

    const [, dia, mesNome, ano] = matchData;
    const data = `${ano}-${converterMesParaNumero(mesNome)}-${dia.padStart(2, '0')}`;

    if (data < dataInicio || data > dataFim) continue;

    // Depois da data vêm pares de linhas: nome da unidade + endereço.
    // Uma linha "pai" pode englobar várias datas, então corta no ponto em que
    // aparece a próxima data — senão ela seria lida como nome de unidade.
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

  // Sem "Voltar para a tela inicial" aqui: esse link devolve para o formulário
  // de matrícula e encerra a sessão, então quem chama refaz o login para a
  // próxima especialidade.
  return vagasNoPeriodo; 
}

/**
 * Entra na unidade de uma vaga e lê os horários livres.
 *
 * Os horários não existem na grade de datas: o link da unidade só carrega
 * `wr('44,1625,2026-08-10')`, sem hora. Eles só aparecem na tela seguinte, em
 * botões como `whrora('36,127546,2026-08-29,07:30')`. Por isso essa busca é
 * feita apenas para as vagas novas — varrer as 30 já conhecidas a cada ciclo
 * seria carga desnecessária no site.
 *
 * Precisa ser chamada com a página ainda na grade de datas.
 *
 * @returns {Promise<string[]>} horários no formato "07:30", ou [] se não deu
 *   para abrir a unidade (o alerta segue sem horário, em vez de falhar).
 */
export async function buscarHorarios(page, vaga) {
  // vaga.profissional é "HOSPITAL EXEMPLO — RUA EXEMPLO...",
  // mas o link traz só o nome da unidade, antes do travessão.
  const unidade = vaga.profissional.split(' — ')[0].trim();

  const linhaDaData = page
    .locator('tr')
    .filter({ hasText: new RegExp(escaparRegex(formatarDataExtenso(vaga.data))) })
    .first();

  const link = linhaDaData
    .getByRole('link', { name: new RegExp(escaparRegex(unidade)) })
    .first();

  if ((await link.count()) === 0) {
    // Mensagem detalhada de propósito: é a única pista de por que a busca de
    // horário não aconteceu, e distingue "a grade sumiu" de "o link mudou".
    throw new Error(
      `link da unidade "${unidade}" não encontrado na linha de ${vaga.data} ` +
        `(grade visível: ${await naGradeDeDatas(page)}, url: ${page.url()})`
    );
  }

  await link.click();
  await page.waitForLoadState('networkidle');

  // Os horários são botões cujo rótulo é só "HH:MM". Mirar direto neles (em
  // vez de varrer todos os botões da página) permite esperar a renderização:
  // o networkidle às vezes dispara antes de a grade de horários existir.
  const botoesHorario = page.getByRole('button', { name: /^\d{1,2}:\d{2}$/ });
  await botoesHorario
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {}); // pode realmente não haver horário livre

  const horarios = (await botoesHorario.allInnerTexts()).map((t) => t.trim());

  // Tentar voltar DEPOIS de já ter os horários em mãos, e sem propagar o erro:
  // se o retorno falhar, o que foi lido continua valendo. Quem chama detecta a
  // falha pelo naGradeDeDatas e para de buscar as próximas.
  await voltarParaGrade(page).catch((erro) => {
    console.log(`  (falha ao voltar: ${erro.message})`);
  });

  return [...new Set(horarios)].sort();
}

/** Da tela de horários de volta para a grade de datas. */
async function voltarParaGrade(page) {
  // O rótulo é "Voltar para a tela ANTERIOR" — perigosamente parecido com
  // "Voltar para a tela INICIAL", que reinicia a sessão e derruba o login.
  // Por isso o nome vai completo, e não um "Voltar" solto que casaria com os
  // dois. O elemento é um <a class="ui-commandlink"> com um ícone de seta.
  const voltar = page.getByRole('link', { name: 'Voltar para a tela anterior' });
  const quantos = await voltar.count().catch(() => 0);

  if (quantos > 0) {
    await voltar.first().click({ timeout: 10000 }).catch(() => {});

    // O link é um ui-commandlink: dispara AJAX (com o dlgProgresso) e troca o
    // painel sem recarregar a página. O networkidle termina antes disso, então
    // é preciso esperar a grade reaparecer em vez de conferir na hora.
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

/** A grade mostra a data por extenso: "2026-08-29" → "29 de Agosto de 2026". */
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

/** A grade continua acessível? Serve para saber se o "Voltar" funcionou. */
export async function naGradeDeDatas(page) {
  // Identificar a grade pelos links de unidade, e não pelo id do container: os
  // ids são gerados pelo JSF e mudam conforme o fluxo (pnlUniDatas_content num
  // caso, j_idt100:0:dtgrd_content noutro). Os links, esses, estão sempre lá.
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
