/**
 * Depois do login, seleciona a especialidade e lê as vagas disponíveis na
 * agenda, devolvendo só as que caem dentro do período configurado.
 *
 * Assim como em login.js, os seletores marcados com TODO precisam ser
 * ajustados com base no fluxo real (use `npm run inspecionar`).
 */
export async function verificarEspecialidade(page, especialidadeConfig) {
  const { nome, dataInicio, dataFim } = especialidadeConfig;

  // TODO: selecionar a especialidade/profissional na tela de agendamento
  // Exemplo: await page.getByLabel('Especialidade').selectOption(nome);
  await page.getByLabel("Especialidade", { exact: false }).selectOption(nome);

  await page.waitForLoadState("networkidle");

  // TODO: ajustar como a agenda é lida. Duas situações comuns:
  //
  // (a) A agenda mostra uma lista/tabela de horários disponíveis:
  //     cada linha tem data, hora e profissional.
  //
  // (b) A agenda é um calendário e é preciso navegar mês a mês clicando em
  //     dias "com vaga" (geralmente destacados com uma cor/classe CSS
  //     diferente dos dias sem vaga).
  //
  // O código abaixo assume o cenário (a): uma lista de elementos com os
  // dados da vaga. Ajuste os seletores conforme o que aparecer no
  // Playwright Inspector.
  const linhas = await page.locator("[data-vaga-disponivel]").all(); // TODO: seletor real

  const vagasNoPeriodo = [];

  for (const linha of linhas) {
    // TODO: extrair data/hora/profissional reais de cada linha
    const dataTexto = await linha.getAttribute("data-data"); // ex: "2026-07-30"
    const horaTexto = await linha.getAttribute("data-hora"); // ex: "14:30"
    const profissional = await linha.getAttribute("data-profissional");

    if (!dataTexto) continue;

    if (dataTexto >= dataInicio && dataTexto <= dataFim) {
      vagasNoPeriodo.push({
        data: dataTexto,
        hora: horaTexto ?? "horário não informado",
        profissional: profissional ?? undefined,
      });
    }
  }

  return vagasNoPeriodo;
}
