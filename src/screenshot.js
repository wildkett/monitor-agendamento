// Quando uma execução falha, o workflow sobe o screenshot como artifact. Em
// repositório público qualquer pessoa baixa esse arquivo, e a tela de login
// mostra nome, matrícula, CPF, nascimento, e-mail e telefone preenchidos.
//
// Então antes de capturar eu troco o valor dos campos por bolinhas. O que
// interessa no screenshot é em que tela o fluxo parou, e isso continua visível.
export async function capturarTelaSemDados(page, caminho) {
  await page
    .evaluate(() => {
      for (const campo of document.querySelectorAll("input, textarea")) {
        if (campo.type === "hidden" || !campo.value) continue;
        campo.value = "•".repeat(Math.min(campo.value.length, 12));
      }
    })
    .catch(() => {}); // se a página já morreu, ainda vale tentar a captura

  await page.screenshot({ path: caminho, fullPage: true }).catch(() => {});
}
