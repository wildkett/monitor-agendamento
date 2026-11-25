// Copyright (c) 2026 Kettly Lima
// SPDX-License-Identifier: MIT

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

  // O modal de encaminhamentos fica aberto de propósito: o index.js lê as
  // especialidades dele antes de fechar.
  await modal(page)
    .waitFor({ state: "visible", timeout: 10000 })
    .catch(() => {}); // sem pendências o modal nem abre

  // Campo recusado na validação deixa o site parado na tela inicial, sem erro.
  // Falho aqui em vez de estourar timeout depois, procurando o dropdown.
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

// Especialidades do modal (encaminhamentos e retornos). Elas somem do dropdown,
// então o botão "Agendar" daqui é o único caminho até elas.
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
    // Sem o nome: a mensagem vai pro log público do Actions.
    throw new Error("a especialidade não foi encontrada entre as linhas do modal.");
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

// Matrícula, CPF e Telefone têm máscara de entrada. O fill() é descartado pela
// máscara, e digitar antes do JS dela carregar embaralha os dígitos. Forçar o
// cursor não resolve: a máscara controla ele sozinha. Então digito, confiro e
// repito se não bateu, sem depender da velocidade da máquina.
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

  // Descreve o sintoma sem mostrar o valor: o mascaramento de secrets do Actions
  // só cobre o texto idêntico, e o valor embaralhado apareceria no log.
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
