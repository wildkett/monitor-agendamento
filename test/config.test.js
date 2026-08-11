import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { carregarEspecialidades, carregarConfig } from "../src/config.js";

const OBRIGATORIAS = {
  AGENDA_URL: "https://site-do-convenio.com.br/Agenda",
  CONVENIO: "Convênio Exemplo",
  MATRICULA: "123456",
  NOME_COMPLETO: "Fulana de Tal",
  DATA_NASCIMENTO: "01/01/2000",
  CPF: "00000000000",
  SEXO: "Feminino",
  EMAIL: "fulana@exemplo.com",
  TELEFONE: "11999999999",
  TELEGRAM_BOT_TOKEN: "123:abc",
  TELEGRAM_CHAT_ID: "456",
};

const TODAS = [...Object.keys(OBRIGATORIAS), "ESPECIALIDADES", "SEM_ALERTA"];

let ambienteOriginal;

beforeEach(() => {
  ambienteOriginal = {};
  for (const chave of TODAS) {
    ambienteOriginal[chave] = process.env[chave];
    delete process.env[chave];
  }
});

afterEach(() => {
  for (const chave of TODAS) {
    if (ambienteOriginal[chave] === undefined) delete process.env[chave];
    else process.env[chave] = ambienteOriginal[chave];
  }
});

function comAmbienteCompleto(extra = {}) {
  Object.assign(process.env, OBRIGATORIAS, extra);
}

describe("carregarEspecialidades pelo secret", () => {
  test("lê a lista de ESPECIALIDADES", () => {
    process.env.ESPECIALIDADES =
      '[{"nome":"CARDIOLOGIA","dataInicio":"2026-01-01","dataFim":"2026-03-31"}]';
    const lista = carregarEspecialidades();
    assert.equal(lista.length, 1);
    assert.equal(lista[0].nome, "CARDIOLOGIA");
  });

  test("aceita espaço em volta, que sobra fácil ao colar o secret", () => {
    process.env.ESPECIALIDADES =
      '  [{"nome":"CARDIOLOGIA","dataInicio":"2026-01-01","dataFim":"2026-03-31"}]  ';
    assert.equal(carregarEspecialidades().length, 1);
  });

  test("JSON quebrado avisa que o problema é o secret", () => {
    process.env.ESPECIALIDADES = "isso não é json";
    assert.throws(() => carregarEspecialidades(), /ESPECIALIDADES não é um JSON válido/);
  });

  test("lista vazia é erro, senão o monitor rodaria sem verificar nada", () => {
    process.env.ESPECIALIDADES = "[]";
    assert.throws(() => carregarEspecialidades(), /pelo menos uma especialidade/);
  });

  test("item sem dataFim é erro, e a mensagem mostra o item", () => {
    process.env.ESPECIALIDADES = '[{"nome":"CARDIOLOGIA","dataInicio":"2026-01-01"}]';
    assert.throws(() => carregarEspecialidades(), /Item inválido.*CARDIOLOGIA/s);
  });
});

describe("carregarEspecialidades pelos arquivos", () => {
  let pasta;
  let local;
  let exemplo;

  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), "monitor-config-"));
    local = join(pasta, "especialidades.json");
    exemplo = join(pasta, "especialidades.example.json");
    writeFileSync(
      exemplo,
      JSON.stringify([{ nome: "DO EXEMPLO", dataInicio: "2026-01-01", dataFim: "2026-03-31" }])
    );
  });

  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  test("sem o secret, usa o arquivo local", () => {
    writeFileSync(
      local,
      JSON.stringify([{ nome: "DO LOCAL", dataInicio: "2026-01-01", dataFim: "2026-03-31" }])
    );
    const lista = carregarEspecialidades({ arquivoLocal: local, arquivoExemplo: exemplo });
    assert.equal(lista[0].nome, "DO LOCAL");
  });

  test("sem o secret e sem o arquivo local, cai no exemplo", () => {
    const lista = carregarEspecialidades({ arquivoLocal: local, arquivoExemplo: exemplo });
    assert.equal(lista[0].nome, "DO EXEMPLO");
  });

  test("o secret tem preferência sobre o arquivo local", () => {
    process.env.ESPECIALIDADES =
      '[{"nome":"DO SECRET","dataInicio":"2026-01-01","dataFim":"2026-03-31"}]';
    writeFileSync(
      local,
      JSON.stringify([{ nome: "DO LOCAL", dataInicio: "2026-01-01", dataFim: "2026-03-31" }])
    );
    const lista = carregarEspecialidades({ arquivoLocal: local, arquivoExemplo: exemplo });
    assert.equal(lista[0].nome, "DO SECRET");
  });
});

describe("carregarConfig", () => {
  test("monta a config com tudo preenchido", () => {
    comAmbienteCompleto({
      ESPECIALIDADES: '[{"nome":"CARDIOLOGIA","dataInicio":"2026-01-01","dataFim":"2026-03-31"}]',
    });
    const config = carregarConfig();
    assert.equal(config.agendaUrl, OBRIGATORIAS.AGENDA_URL);
    assert.equal(config.especialidades.length, 1);
  });

  test("variável faltando diz qual é o nome dela", () => {
    comAmbienteCompleto({
      ESPECIALIDADES: '[{"nome":"CARDIOLOGIA","dataInicio":"2026-01-01","dataFim":"2026-03-31"}]',
    });
    delete process.env.TELEGRAM_CHAT_ID;
    assert.throws(() => carregarConfig(), /TELEGRAM_CHAT_ID/);
  });
});

describe("SEM_ALERTA", () => {
  // O workflow_dispatch manda a string "false" com a caixinha desmarcada, e
  // string não vazia é verdadeira em JS. Sem esse cuidado, toda execução manual
  // ficaria muda.
  const casos = [
    [undefined, false, "não definido (é o caso do cron)"],
    ["", false, "vazio"],
    ["false", false, 'a string "false" do workflow_dispatch'],
    ["FALSE", false, "maiúsculas"],
    ["0", false, "zero"],
    ["true", true, "true"],
    ["1", true, "um"],
    ["sim", true, "qualquer outro texto"],
  ];

  for (const [valor, esperado, descricao] of casos) {
    test(`${descricao} -> ${esperado}`, () => {
      comAmbienteCompleto({
        ESPECIALIDADES: '[{"nome":"CARDIOLOGIA","dataInicio":"2026-01-01","dataFim":"2026-03-31"}]',
      });
      if (valor === undefined) delete process.env.SEM_ALERTA;
      else process.env.SEM_ALERTA = valor;

      assert.equal(carregarConfig().semAlerta, esperado);
    });
  }
});
