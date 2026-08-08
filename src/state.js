import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAMINHO_ESTADO = join(__dirname, "..", "state.json");

export function carregarEstado() {
  if (!existsSync(CAMINHO_ESTADO)) return {};
  try {
    return JSON.parse(readFileSync(CAMINHO_ESTADO, "utf-8"));
  } catch {
    return {};
  }
}

export function salvarEstado(estado) {
  writeFileSync(CAMINHO_ESTADO, JSON.stringify(estado, null, 2) + "\n");
}

// Cria uma chave única pra cada vaga, pra saber se ela já foi notificada antes.
//
// O horário fica de fora de propósito: ele só é buscado depois, e apenas para
// as vagas novas (custa uma navegação extra por vaga). Se entrasse na chave,
// toda vaga já conhecida mudaria de identidade ao ganhar horário e seria
// anunciada de novo.
export function chaveVaga(vaga) {
  return `${vaga.data}|${vaga.profissional ?? ""}`;
}

// Recebe as vagas encontradas agora e devolve só as que ainda não foram notificadas
export function filtrarNovas(estado, especialidade, vagasEncontradas) {
  const jaNotificadas = new Set(estado[especialidade] ?? []);
  return vagasEncontradas.filter((v) => !jaNotificadas.has(chaveVaga(v)));
}

export function atualizarEstado(estado, especialidade, vagasEncontradas) {
  estado[especialidade] = vagasEncontradas.map(chaveVaga);
  return estado;
}
