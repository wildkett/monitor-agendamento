// "Segunda-feira , 10 de Agosto de 2026" — o mês vem por extenso e pode ter
// acento (Março), por isso [a-zA-ZçÇãÃ]+ no lugar de \w+.
const REGEX_DATA = /(\d{1,2}) de ([a-zA-ZçÇãÃ]+) de (\d{4})/;

export async function verificarEspecialidade(page, especialidadeConfig) {
  const { nome, dataInicio, dataFim } = especialidadeConfig;

  await page.waitForLoadState('networkidle');

  // Seleciona a especialidade (clica no botão do dropdown)
  await page.locator('[id="frmInicial:group"]').getByRole('button').click();

  // Espera a opção aparecer e clica nela
  await page.getByRole('option', { name: nome }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('option', { name: nome }).click();

  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.waitForLoadState('networkidle');

  // A grade de datas chega por AJAX e o networkidle às vezes dispara antes
  // dela renderizar. Esperar o container evita ler a página vazia e concluir,
  // errado, que não há vaga nenhuma.
  const grade = page.locator('[id="frmInicial:pnlUniDatas_content"]');
  const temGrade = await grade
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!temGrade) {
    console.log(`  -> Nenhuma agenda disponível para ${nome}`);
    await voltarAoInicio(page);
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

  await voltarAoInicio(page);

  return vagasNoPeriodo;
}

async function voltarAoInicio(page) {
  await page.getByRole('link', { name: 'Voltar para a tela inicial' }).click();
  await page.waitForLoadState('networkidle');
}

function converterMesParaNumero(mesNome) {
  const meses = {
    'Janeiro': '01', 'Fevereiro': '02', 'Março': '03', 'Abril': '04',
    'Maio': '05', 'Junho': '06', 'Julho': '07', 'Agosto': '08',
    'Setembro': '09', 'Outubro': '10', 'Novembro': '11', 'Dezembro': '12',
  };
  return meses[mesNome] || '01';
}
