export async function login(page, config) {
  await page.goto(config.agendaUrl, { waitUntil: "networkidle" });

  await preencherComMascara(
    page.getByRole("textbox", { name: "Matrícula:" }),
    config.matricula,
    "Matrícula"
  );

  // Seleciona convênio (após preencher matrícula)
  await page.getByText(`Selecione o Convênio: ${config.convenio}`).click();

  // Com a matrícula preenchida, o site consulta o banco do convênio e traz
  // nome, data de nascimento e e-mail sozinho. Esperar esse retorno antes de
  // seguir — se pularmos, o formulário vai para validação ainda incompleto.
  await esperarPreenchido(
    page.getByRole("textbox", { name: "Nome Completo:" }),
    "Nome Completo"
  );

  await preencherComMascara(
    page.getByRole("textbox", { name: "CPF:" }),
    config.cpf,
    "CPF"
  );
  await preencherComMascara(
    page.getByRole("textbox", { name: "Telefone Celular:" }),
    config.telefone,
    "Telefone Celular"
  );

  // Clica em Avançar
  await page.getByRole("button", { name: "Avançar" }).click();

  await page.waitForLoadState("networkidle");

  // O modal de encaminhamentos/retornos é deixado ABERTO de propósito: as
  // especialidades listadas nele saem do dropdown, e só dá para agendá-las
  // pelo botão "Agendar" de dentro do modal. Quem decide fechar é o chamador,
  // depois de tratar essas especialidades.
  await modal(page)
    .waitFor({ state: "visible", timeout: 10000 })
    .catch(() => {}); // sem pendências, o modal nem aparece

  // Se algum campo obrigatório não passar na validação, o site simplesmente
  // não sai da tela inicial — melhor falhar aqui com uma mensagem clara do que
  // estourar timeout lá na frente procurando o dropdown de especialidade.
  if (!(await modalAberto(page))) {
    const dropdown = page.locator('[id="frmInicial:group"]');
    await dropdown.waitFor({ state: "visible", timeout: 15000 }).catch(() => {
      throw new Error(
        "O login não avançou da tela inicial — algum campo obrigatório não foi " +
          "aceito. Rode com HEADLESS=false para ver o formulário."
      );
    });
  }
}

/**
 * O modal visível da tela. O ID é dinâmico (j_idt294, j_idt295...) e o
 * PrimeFaces deixa vários .ui-dialog escondidos no HTML desde o carregamento,
 * por isso o :visible é obrigatório — sem ele, pega um modal invisível.
 */
export function modal(page) {
  return page.locator(".ui-dialog:visible").first();
}

export async function modalAberto(page) {
  return modal(page)
    .isVisible()
    .catch(() => false);
}

/**
 * Lê as especialidades listadas no modal — tanto as "Solicitações de
 * Encaminhamento" quanto o "Acompanhamento Médico (Retornos)". Cada linha
 * dessas tabelas tem o nome da especialidade e um botão "Agendar".
 *
 * Isso importa porque essas especialidades são removidas do dropdown: para
 * elas, o botão do modal é o único caminho.
 */
export async function listarEncaminhamentos(page) {
  if (!(await modalAberto(page))) return [];

  const linhas = await modal(page)
    .locator("tr")
    .filter({ has: page.getByRole("button", { name: "Agendar" }) })
    .all();

  const nomes = [];
  for (const linha of linhas) {
    // Ler a primeira célula, e não a primeira linha do texto: na tabela de
    // retornos as colunas (especialidade, médico, dias) vêm todas na mesma
    // linha, separadas por espaços — "OTORRINOLARINGOLOGIA NOME DO MEDICO 15".
    const especialidade = await primeiraCelula(linha);
    if (especialidade && especialidade !== "Agendar") nomes.push(especialidade);
  }

  return nomes;
}

async function primeiraCelula(linha) {
  return (await linha.locator("td").first().innerText().catch(() => "")).trim();
}

/**
 * Clica no "Agendar" da linha correspondente. O site fecha o modal e já deixa
 * a especialidade escolhida no dropdown — resta só clicar em "Avançar".
 */
export async function agendarPeloModal(page, nome) {
  const linhas = await modal(page)
    .locator("tr")
    .filter({ has: page.getByRole("button", { name: "Agendar" }) })
    .all();

  let alvo = null;
  for (const linha of linhas) {
    if ((await primeiraCelula(linha)) === nome) {
      alvo = linha;
      break;
    }
  }

  if (!alvo) {
    throw new Error(`"${nome}" não foi encontrada entre as linhas do modal.`);
  }

  await alvo.getByRole("button", { name: "Agendar" }).click();

  await page
    .locator(".ui-widget-overlay")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle");
}

function somenteDigitos(valor) {
  return valor.replace(/\D/g, "");
}

/**
 * Matrícula, CPF e Telefone têm máscara de entrada, que é sensível de duas
 * formas:
 *
 *   - fill() joga o texto de uma vez e a máscara descarta, deixando o campo
 *     vazio (foi o que aconteceu com a matrícula na execução do GitHub);
 *   - se a digitação começar antes do JavaScript da máscara terminar de
 *     inicializar, ela reposiciona o cursor no meio do caminho e os dígitos
 *     saem fora de ordem. Na nuvem isso fazia o primeiro dígito do CPF ser
 *     empurrado até o fim, invalidando o número inteiro.
 *
 * Não adianta forçar a posição do cursor: o campo já contém o gabarito inteiro
 * ("__.___.__._____.__-_") e a máscara gerencia o cursor sozinha. O que
 * funciona é digitar, conferir o resultado e repetir se saiu errado — o que
 * cobre a corrida de inicialização sem depender da velocidade da máquina.
 */
async function preencherComMascara(campo, valor, rotulo) {
  const digitos = somenteDigitos(valor);
  const TENTATIVAS = 3;
  let ultimoResultado = "";

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    await campo.click();
    await campo.press("Control+a");
    await campo.press("Backspace");

    await campo.pressSequentially(digitos, { delay: 60 });

    // A máscara insere pontuação, então a conferência é só nos dígitos.
    ultimoResultado = somenteDigitos(await campo.inputValue());
    if (ultimoResultado === digitos) return;

    // Dá um tempo para a máscara terminar de inicializar antes de repetir.
    await campo.page().waitForTimeout(1000 * tentativa);
  }

  // A mensagem descreve o sintoma sem incluir os valores: ela vai para o log
  // do GitHub Actions, e o mascaramento automático de secrets só cobre o que
  // casa exatamente com o valor cadastrado — o texto embaralhado pela máscara
  // não casaria com nada e apareceria em claro.
  const diagnostico =
    ultimoResultado.length === 0
      ? "o campo ficou vazio"
      : ultimoResultado.length !== digitos.length
        ? `entraram ${ultimoResultado.length} dígito(s) em vez de ${digitos.length}`
        : "os dígitos entraram fora de ordem";

  throw new Error(
    `O campo "${rotulo}" não foi preenchido corretamente após ${TENTATIVAS} ` +
      `tentativas: ${diagnostico}. Confira o secret correspondente.`
  );
}

/**
 * Os campos que o site preenche sozinho a partir da matrícula chegam por AJAX.
 * Em máquina local isso é quase instantâneo, mas no runner do GitHub demora o
 * suficiente para o resto do fluxo passar na frente.
 */
async function esperarPreenchido(campo, rotulo) {
  const limite = Date.now() + 30000;

  while (Date.now() < limite) {
    if ((await campo.inputValue()).trim() !== "") return;
    await campo.page().waitForTimeout(500);
  }

  throw new Error(
    `O site não preencheu "${rotulo}" a partir da matrícula. A matrícula pode ` +
      `estar incorreta, ou a consulta ao convênio falhou/demorou demais.`
  );
}

/**
 * Fecha o modal. Necessário antes de usar o dropdown, porque a máscara do
 * PrimeFaces (.ui-widget-overlay) intercepta todos os cliques enquanto ele
 * estiver aberto.
 */
export async function fecharModal(page) {
  if (!(await modalAberto(page))) return;

  // O "X" da barra de título é um <a role="button" aria-label="Close">
  await modal(page).locator("a.ui-dialog-titlebar-close").click();

  await page
    .locator(".ui-widget-overlay")
    .waitFor({ state: "hidden", timeout: 10000 })
    .catch(() => {
      throw new Error(
        "O modal de agendamentos não fechou — a máscara continua bloqueando a tela."
      );
    });
}
