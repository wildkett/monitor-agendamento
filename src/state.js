import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAMINHO_ESTADO = join(__dirname, "..", "state.json");

// O workflow commita o state.json de volta a cada execução, então o conteúdo
// dele fica visível pra quem abrir o repositório. Em texto puro isso mostrava a
// especialidade, a data e a unidade de cada vaga. Aqui só entra o hash: pra
// saber se uma vaga já foi avisada basta comparar igualdade, nunca precisei ler
// o valor de volta.
function resumir(texto) {
  return createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

// O caminho entra por parâmetro pro teste poder usar um arquivo temporário em
// vez do state.json de verdade.
export function carregarEstado(caminho = CAMINHO_ESTADO) {
  if (!existsSync(caminho)) return {};
  try {
    return JSON.parse(readFileSync(caminho, "utf-8"));
  } catch {
    // Arquivo corrompido não pode derrubar a execução: começar do zero só faz
    // as vagas abertas serem avisadas de novo.
    return {};
  }
}

export function salvarEstado(estado, caminho = CAMINHO_ESTADO) {
  writeFileSync(caminho, JSON.stringify(estado, null, 2) + "\n");
}

// Identifica cada vaga pra saber se ela já foi notificada antes.
//
// O horário fica de fora de propósito. Ele só é buscado depois, e só pras vagas
// novas, porque custa uma navegação a mais por vaga. Se entrasse aqui, toda
// vaga conhecida mudaria de identidade ao ganhar horário e seria avisada de novo.
export function chaveVaga(vaga) {
  return resumir(`${vaga.data}|${vaga.profissional ?? ""}`);
}

export function filtrarNovas(estado, especialidade, vagasEncontradas) {
  const jaNotificadas = new Set(estado[resumir(especialidade)] ?? []);
  return vagasEncontradas.filter((v) => !jaNotificadas.has(chaveVaga(v)));
}

export function atualizarEstado(estado, especialidade, vagasEncontradas) {
  estado[resumir(especialidade)] = vagasEncontradas.map(chaveVaga);
  return estado;
}
