// Copyright (c) 2026 Kettly Lima
// SPDX-License-Identifier: MIT

// O screenshot de erro vira artifact público e a tela de login mostra os dados
// pessoais preenchidos. Troco o valor dos campos por bolinhas antes de
// capturar: o que importa é em que tela o fluxo parou.
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
