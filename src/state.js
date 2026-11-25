// Copyright (c) 2026 Kettly Lima
// SPDX-License-Identifier: MIT

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHmac } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAMINHO_ESTADO = join(__dirname, "..", "state.json");

// O state.json é commitado no repositório público, então guarda só hashes: pra
// saber se uma vaga já foi avisada basta comparar igualdade. É HMAC e não
// SHA-256 puro porque nomes de especialidade são poucos e previsíveis, e o hash
// puro se reverte testando uma lista deles.
function resumir(texto, segredo) {
  if (!segredo) throw new Error("STATE_KEY não definida: sem ela o estado não é protegido.");
  return createHmac("sha256", segredo).update(texto).digest("hex").slice(0, 16);
}

// O caminho é parâmetro pros testes usarem um arquivo temporário.
export function carregarEstado(caminho = CAMINHO_ESTADO) {
  if (!existsSync(caminho)) return {};
  try {
    return JSON.parse(readFileSync(caminho, "utf-8"));
  } catch {
    // Arquivo corrompido não derruba a execução: no pior caso, avisa de novo.
    return {};
  }
}

export function salvarEstado(estado, caminho = CAMINHO_ESTADO) {
  writeFileSync(caminho, JSON.stringify(estado, null, 2) + "\n");
}

// O horário fica fora da chave: ele só é buscado depois, pras vagas novas. Se
// entrasse, a vaga mudaria de chave ao ganhar horário e seria avisada de novo.
export function chaveVaga(vaga, segredo) {
  return resumir(`${vaga.data}|${vaga.profissional ?? ""}`, segredo);
}

export function filtrarNovas(estado, especialidade, vagasEncontradas, segredo) {
  const jaNotificadas = new Set(estado[resumir(especialidade, segredo)] ?? []);
  return vagasEncontradas.filter((v) => !jaNotificadas.has(chaveVaga(v, segredo)));
}

export function atualizarEstado(estado, especialidade, vagasEncontradas, segredo) {
  estado[resumir(especialidade, segredo)] = vagasEncontradas.map((v) => chaveVaga(v, segredo));
  return estado;
}
