export async function login(page, config) {
  await page.goto(config.agendaUrl, { waitUntil: "networkidle" });

  // Preenche matrícula
  await page.getByRole('textbox', { name: 'Matrícula:' }).click();
  await page.getByRole('textbox', { name: 'Matrícula:' }).fill(config.matricula);

  // Seleciona convênio (após preencher matrícula)
  await page.getByText(`Selecione o Convênio: ${config.convenio}`).click();

  // CPF e telefone são os únicos campos que o site não preenche sozinho, e os
  // dois têm máscara: fill() joga o texto de uma vez e a máscara descarta,
  // deixando o campo vazio. pressSequentially digita tecla a tecla, que é o
  // que a máscara espera — e só com os dígitos, sem pontuação.
  const cpf = page.getByRole('textbox', { name: 'CPF:' });
  await cpf.click();
  await cpf.pressSequentially(somenteDigitos(config.cpf), { delay: 50 });

  const telefone = page.getByRole('textbox', { name: 'Telefone Celular:' });
  await telefone.click();
  await telefone.pressSequentially(somenteDigitos(config.telefone), { delay: 50 });

  // Clica em Avançar
  await page.getByRole("button", { name: "Avançar" }).click();

  await fecharModal(page);

  await page.waitForLoadState("networkidle");

  // Se algum campo obrigatório não passar na validação, o site simplesmente
  // não sai da tela inicial — melhor falhar aqui com uma mensagem clara do que
  // estourar timeout lá na frente procurando o dropdown de especialidade.
  const dropdown = page.locator('[id="frmInicial:group"]');
  await dropdown.waitFor({ state: "visible", timeout: 15000 }).catch(() => {
    throw new Error(
      "O login não avançou da tela inicial — algum campo obrigatório não foi " +
        "aceito. Rode com HEADLESS=false para ver o formulário."
    );
  });
}

function somenteDigitos(valor) {
  return valor.replace(/\D/g, "");
}

/**
 * Depois do "Avançar" o site abre um modal listando os agendamentos que a
 * pessoa já tem. Ele precisa ser fechado, senão a máscara do PrimeFaces
 * (.ui-widget-overlay) intercepta todos os cliques da tela seguinte.
 *
 * O ID do modal é dinâmico (j_idt294, j_idt295...) e o PrimeFaces já deixa
 * vários .ui-dialog escondidos no HTML desde o carregamento — por isso o
 * seletor precisa do :visible, senão pega um modal invisível.
 */
async function fecharModal(page) {
  const modal = page.locator(".ui-dialog:visible").first();

  // O modal chega por AJAX, então pode demorar um instante pra aparecer.
  const apareceu = await modal
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!apareceu) return; // sem agendamentos prévios, o modal nem aparece

  // O "X" da barra de título é um <a role="button" aria-label="Close">
  await modal.locator("a.ui-dialog-titlebar-close").click();

  await page
    .locator(".ui-widget-overlay")
    .waitFor({ state: "hidden", timeout: 10000 })
    .catch(() => {
      throw new Error(
        "O modal de agendamentos não fechou — a máscara continua bloqueando a tela."
      );
    });
}
