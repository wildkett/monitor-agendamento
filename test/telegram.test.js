// Copyright (c) 2026 Kettly Lima
// SPDX-License-Identifier: MIT

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { formatarMensagemVaga } from "../src/telegram.js";

const URL_AGENDA = "https://site-do-convenio.com.br/Agenda";

describe("formatarMensagemVaga", () => {
  test("mostra data com ano quando não tem horário", () => {
    const mensagem = formatarMensagemVaga({
      especialidade: "CARDIOLOGIA",
      vagas: [{ data: "2026-08-15", profissional: "UNIDADE CENTRO" }],
      urlAgenda: URL_AGENDA,
    });
    assert.match(mensagem, /<b>15\/08\/2026<\/b>/);
    assert.match(mensagem, /UNIDADE CENTRO/);
  });

  test("mostra o horário quando tem", () => {
    const mensagem = formatarMensagemVaga({
      especialidade: "CARDIOLOGIA",
      vagas: [{ data: "2026-08-12", hora: "07:30, 08:00", profissional: "HOSPITAL" }],
      urlAgenda: URL_AGENDA,
    });
    assert.match(mensagem, /<b>12\/08 às 07:30, 08:00<\/b>/);
  });

  // Texto lido do site com < ou & faria o Telegram recusar a mensagem.
  test("escapa o HTML do texto que vem do site", () => {
    const mensagem = formatarMensagemVaga({
      especialidade: "A&B",
      vagas: [{ data: "2026-08-12", profissional: "<UNIDADE> R&D" }],
      urlAgenda: URL_AGENDA,
    });
    assert.match(mensagem, /A&amp;B/);
    assert.match(mensagem, /&lt;UNIDADE&gt; R&amp;D/);
    assert.doesNotMatch(mensagem, /<UNIDADE>/);
  });
});
