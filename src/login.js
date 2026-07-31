/**
 * Faz o login inicial no site de agendamento: escolhe o convênio, informa a
 * matrícula e confirma os dados pessoais que a plataforma carrega.
 *
 * ATENÇÃO: os seletores abaixo (marcados com TODO) são placeholders.
 * O site é feito em JSF/PrimeFaces e os campos só existem depois de
 * carregamento via AJAX, então não dá pra descobrir os IDs reais sem abrir
 * o site num navegador de verdade.
 *
 * Como pegar os seletores certos:
 *   1. Rode:  AGENDA_URL="https://site-do-convenio.com.br/Agenda" npm run inspecionar
 *   2. Uma janela do Chrome abre gravando tudo que você clicar.
 *   3. Faça o fluxo manualmente: escolha o convênio, digite a matrícula,
 *      confirme os dados, clique em "Avançar".
 *   4. O Playwright Inspector mostra, ao vivo, o código de cada ação
 *      (ex: `await page.getByLabel('Matrícula').fill('123')`).
 *   5. Copie esses trechos aqui, substituindo os TODOs.
 */
export async function login(page, config) {
  await page.goto(config.agendaUrl, { waitUntil: "networkidle" });

  // TODO: selecionar o convênio (radio/dropdown "Convênio Exemplo" ou "Particular")
  // Exemplo depois de gravar com codegen:
  // await page.getByLabel(config.convenio).check();
  await page.getByText(config.convenio, { exact: false }).click();

  // TODO: preencher a matrícula
  // await page.getByLabel('Matrícula').fill(config.matricula);
  await page.getByLabel("Matrícula", { exact: false }).fill(config.matricula);

  // O site busca os dados do beneficiário no banco do convênio - esperar
  // o loading sumir antes de continuar.
  await page
    .getByText("Conectando no Banco de Dados", { exact: false })
    .waitFor({ state: "hidden", timeout: 30000 })
    .catch(() => {
      // se esse texto não existir/mudar, não trava o fluxo por causa disso
    });

  // TODO: confirmar/preencher os dados pessoais, caso não venham
  // automaticamente preenchidos pela busca da matrícula.
  // await page.getByLabel('Nome Completo').fill(config.nomeCompleto);
  // await page.getByLabel('Data de Nascimento').fill(config.dataNascimento);
  // await page.getByLabel('CPF').fill(config.cpf);
  // await page.getByLabel(config.sexo).check();
  // await page.getByLabel('E-mail').fill(config.email);
  // await page.getByLabel('Telefone Celular').fill(config.telefone);

  // TODO: clicar em avançar
  // await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole("button", { name: "Avançar" }).click();

  await page.waitForLoadState("networkidle");
}
