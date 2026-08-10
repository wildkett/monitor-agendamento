export async function login(page, config) {
  await page.goto(config.agendaUrl, { waitUntil: "networkidle" });

  await preencherComMascara(
    page.getByRole("textbox", { name: "Matrícula:" }),
    config.matricula,
    "Matrícula"
  );

  await page.getByText(`Selecione o Convênio: ${config.convenio}`).click();

  // Com a matrícula preenchida o site consulta o convênio e traz nome,
  // nascimento e e-mail sozinho. Se eu seguir antes disso chegar, o formulário
  // vai pra validação incompleto.
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

  await page.getByRole("button", { name: "Avançar" }).click();
  await page.waitForLoadState("networkidle");

  // O modal de encaminhamentos/retornos fica ABERTO de propósito. As
  // especialidades que aparecem nele saem do dropdown e só dá pra agendar pelo
  // botão daqui. Quem fecha é o index.js, depois de tratar essas.
  await modal(page)
    .waitFor({ state: "visible", timeout: 10000 })
    .catch(() => {}); // sem pendências o modal nem abre

  // Se algum campo obrigatório não passa na validação, o site simplesmente não
  // sai da tela inicial. Falhar aqui com mensagem clara é melhor do que estourar
  // timeout lá na frente procurando o dropdown.
  if (!(await modalAberto(page))) {
    const dropdown = page.locator('[id="frmInicial:group"]');
    await dropdown.waitFor({ state: "visible", timeout: 15000 }).catch(() => {
      throw new Error(
        "O login não avançou da tela inicial: algum campo obrigatório não foi " +
          "aceito. Rode com HEADLESS=false para ver o formulário."
      );
    });
  }
}

// O ID do modal é dinâmico (j_idt294, j_idt295...) e o PrimeFaces deixa vários
// .ui-dialog escondidos no HTML desde que a página carrega. Sem o :visible eu
// pegava um modal invisível.
export function modal(page) {
  return page.locator(".ui-dialog:visible").first();
}

export async function modalAberto(page) {
  return modal(page)
    .isVisible()
    .catch(() => false);
}

// Lê as especialidades do modal, tanto as "Solicitações de Encaminhamento"
// quanto o "Acompanhamento Médico (Retornos)". Preciso dessa lista porque essas
// especialidades somem do dropdown e o botão daqui vira o único caminho.
export async function listarEncaminhamentos(page) {
  if (!(await modalAberto(page))) return [];

  const linhas = await modal(page)
    .locator("tr")
    .filter({ has: page.getByRole("button", { name: "Agendar" }) })
    .all();

  const nomes = [];
  for (const linha of linhas) {
    const especialidade = await primeiraCelula(linha);
    if (especialidade && especialidade !== "Agendar") nomes.push(especialidade);
  }

  return nomes;
}

// Primeira célula e não primeira linha do texto: na tabela de retornos as
// colunas vêm todas grudadas, tipo "OTORRINOLARINGOLOGIA NOME DO MEDICO 15".
async function primeiraCelula(linha) {
  return (await linha.locator("td").first().innerText().catch(() => "")).trim();
}

// Clica no "Agendar" da linha certa. O site fecha o modal e já deixa a
// especialidade escolhida no dropdown, aí só falta o "Avançar".
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

// Matrícula, CPF e Telefone têm máscara de entrada, e ela deu trabalho de dois
// jeitos diferentes:
//
//   - o fill() joga o texto de uma vez e a máscara descarta, o campo fica vazio
//     (foi o que aconteceu com a matrícula na execução do GitHub);
//   - se a digitação começa antes do JS da máscara terminar de carregar, ela
//     reposiciona o cursor no meio e os dígitos saem fora de ordem. Na nuvem
//     isso jogava o primeiro dígito do CPF pro fim e invalidava o número.
//
// Forçar a posição do cursor não resolve, porque o campo já vem com o gabarito
// inteiro ("__.___.___-__") e a máscara controla o cursor sozinha. O que
// funcionou foi digitar, conferir e repetir se não bateu, o que também cobre a
// demora de carregamento sem depender da velocidade da máquina.
async function preencherComMascara(campo, valor, rotulo) {
  const digitos = somenteDigitos(valor);
  const TENTATIVAS = 3;
  let ultimoResultado = "";

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    await campo.click();
    await campo.press("Control+a");
    await campo.press("Backspace");

    await campo.pressSequentially(digitos, { delay: 60 });

    // A máscara insere pontuação, então comparo só os dígitos.
    ultimoResultado = somenteDigitos(await campo.inputValue());
    if (ultimoResultado === digitos) return;

    await campo.page().waitForTimeout(1000 * tentativa);
  }

  // A mensagem descreve o sintoma sem mostrar o valor. Ela vai pro log do
  // Actions, e o mascaramento automático de secrets só cobre o texto idêntico
  // ao cadastrado: o valor embaralhado pela máscara não casaria e apareceria.
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

// Os campos que o site preenche sozinho a partir da matrícula chegam por AJAX.
// Local é quase instantâneo, mas no runner do GitHub demora o bastante pro
// resto do fluxo passar na frente.
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

// Precisa fechar o modal antes de usar o dropdown: enquanto ele está aberto a
// máscara do PrimeFaces (.ui-widget-overlay) intercepta todos os cliques.
export async function fecharModal(page) {
  if (!(await modalAberto(page))) return;

  // O "X" da barra de título é um <a role="button" aria-label="Close">
  await modal(page).locator("a.ui-dialog-titlebar-close").click();

  await page
    .locator(".ui-widget-overlay")
    .waitFor({ state: "hidden", timeout: 10000 })
    .catch(() => {
      throw new Error(
        "O modal de agendamentos não fechou, a máscara continua bloqueando a tela."
      );
    });
}
