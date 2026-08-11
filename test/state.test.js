import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  chaveVaga,
  filtrarNovas,
  atualizarEstado,
  carregarEstado,
  salvarEstado,
} from "../src/state.js";

const vaga = (data, local) => ({ data, profissional: local });

describe("chaveVaga", () => {
  test("é sempre a mesma pra mesma vaga", () => {
    const a = chaveVaga(vaga("2026-08-11", "HOSPITAL EXEMPLO"));
    const b = chaveVaga(vaga("2026-08-11", "HOSPITAL EXEMPLO"));
    assert.equal(a, b);
  });

  test("muda quando a data muda", () => {
    assert.notEqual(
      chaveVaga(vaga("2026-08-11", "HOSPITAL EXEMPLO")),
      chaveVaga(vaga("2026-08-12", "HOSPITAL EXEMPLO"))
    );
  });

  test("muda quando a unidade muda", () => {
    assert.notEqual(
      chaveVaga(vaga("2026-08-11", "HOSPITAL EXEMPLO")),
      chaveVaga(vaga("2026-08-11", "UNIDADE CENTRO"))
    );
  });

  test("ignora o horário, que só é buscado depois", () => {
    const sem = chaveVaga(vaga("2026-08-11", "HOSPITAL EXEMPLO"));
    const com = chaveVaga({ ...vaga("2026-08-11", "HOSPITAL EXEMPLO"), hora: "07:30" });
    assert.equal(sem, com);
  });

  test("aceita vaga sem unidade", () => {
    assert.equal(typeof chaveVaga({ data: "2026-08-11" }), "string");
  });

  // O state.json vai pro repositório público a cada execução.
  test("não deixa o texto original aparecer", () => {
    const chave = chaveVaga(vaga("2026-08-11", "HOSPITAL EXEMPLO"));
    assert.doesNotMatch(chave, /HOSPITAL|2026/);
    assert.match(chave, /^[0-9a-f]+$/);
  });
});

describe("filtrarNovas", () => {
  const vagas = [vaga("2026-08-11", "HOSPITAL EXEMPLO"), vaga("2026-08-12", "UNIDADE CENTRO")];

  test("com estado vazio, tudo é novo", () => {
    assert.equal(filtrarNovas({}, "CARDIOLOGIA", vagas).length, 2);
  });

  test("depois de registrar, nada é novo", () => {
    const estado = atualizarEstado({}, "CARDIOLOGIA", vagas);
    assert.equal(filtrarNovas(estado, "CARDIOLOGIA", vagas).length, 0);
  });

  test("uma vaga inédita no meio das conhecidas", () => {
    const estado = atualizarEstado({}, "CARDIOLOGIA", vagas);
    const novas = filtrarNovas(estado, "CARDIOLOGIA", [
      ...vagas,
      vaga("2026-08-20", "HOSPITAL EXEMPLO"),
    ]);
    assert.equal(novas.length, 1);
    assert.equal(novas[0].data, "2026-08-20");
  });

  test("vaga conhecida não volta a avisar por ter ganhado horário", () => {
    const estado = atualizarEstado({}, "CARDIOLOGIA", vagas);
    const comHorario = vagas.map((v) => ({ ...v, hora: "07:30" }));
    assert.equal(filtrarNovas(estado, "CARDIOLOGIA", comHorario).length, 0);
  });

  test("uma especialidade não enxerga o estado da outra", () => {
    const estado = atualizarEstado({}, "CARDIOLOGIA", vagas);
    assert.equal(filtrarNovas(estado, "DERMATOLOGIA", vagas).length, 2);
  });

  test("lista vazia devolve lista vazia", () => {
    assert.deepEqual(filtrarNovas({}, "CARDIOLOGIA", []), []);
  });
});

describe("atualizarEstado", () => {
  test("substitui a lista em vez de acumular", () => {
    const vagaA = vaga("2026-08-11", "HOSPITAL EXEMPLO");
    const vagaB = vaga("2026-08-12", "UNIDADE CENTRO");

    const estado = atualizarEstado({}, "CARDIOLOGIA", [vagaA, vagaB]);
    atualizarEstado(estado, "CARDIOLOGIA", [vagaB]);

    // A vaga que saiu do site é esquecida. Se ela reabrir, avisa de novo, que
    // é o comportamento que eu quero.
    assert.equal(filtrarNovas(estado, "CARDIOLOGIA", [vagaA]).length, 1);
    assert.equal(filtrarNovas(estado, "CARDIOLOGIA", [vagaB]).length, 0);
  });

  test("não guarda a especialidade em texto puro", () => {
    const estado = atualizarEstado({}, "CARDIOLOGIA", [vaga("2026-08-11", "X")]);
    assert.equal(Object.keys(estado).includes("CARDIOLOGIA"), false);
    assert.equal(Object.keys(estado).length, 1);
  });
});

describe("carregarEstado e salvarEstado", () => {
  let pasta;
  let arquivo;

  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), "monitor-estado-"));
    arquivo = join(pasta, "state.json");
  });

  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  test("o que foi salvo é o que volta", () => {
    const estado = atualizarEstado({}, "CARDIOLOGIA", [vaga("2026-08-11", "HOSPITAL EXEMPLO")]);
    salvarEstado(estado, arquivo);
    assert.deepEqual(carregarEstado(arquivo), estado);
  });

  test("arquivo que não existe vira estado vazio", () => {
    assert.deepEqual(carregarEstado(join(pasta, "nao-existe.json")), {});
  });

  test("arquivo corrompido vira estado vazio em vez de derrubar a execução", () => {
    writeFileSync(arquivo, "{ isso não é json");
    assert.deepEqual(carregarEstado(arquivo), {});
  });

  test("salva com quebra de linha no fim, pra não sujar o diff do commit", () => {
    salvarEstado({}, arquivo);
    assert.equal(readFileSync(arquivo, "utf-8").endsWith("\n"), true);
  });
});
