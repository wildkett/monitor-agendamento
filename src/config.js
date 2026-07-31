import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function obrigatorio(nome) {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `Variável de ambiente obrigatória não definida: ${nome}. ` +
        `Configure-a como secret no GitHub Actions (ou no seu .env local).`
    );
  }
  return valor;
}

export function carregarEspecialidades() {
  const caminho = join(__dirname, "..", "config", "especialidades.json");
  const lista = JSON.parse(readFileSync(caminho, "utf-8"));

  if (!Array.isArray(lista) || lista.length === 0) {
    throw new Error(
      "config/especialidades.json precisa ter pelo menos uma especialidade."
    );
  }

  for (const item of lista) {
    if (!item.nome || !item.dataInicio || !item.dataFim) {
      throw new Error(
        `Cada especialidade precisa de "nome", "dataInicio" e "dataFim". Item inválido: ${JSON.stringify(
          item
        )}`
      );
    }
  }

  return lista;
}

export function carregarConfig() {
  return {
    agendaUrl: obrigatorio("AGENDA_URL"),
    convenio: obrigatorio("CONVENIO"), // "Convênio Exemplo" ou "Particular"
    matricula: obrigatorio("MATRICULA"),
    nomeCompleto: obrigatorio("NOME_COMPLETO"),
    dataNascimento: obrigatorio("DATA_NASCIMENTO"), // formato do site, ex: DD/MM/AAAA
    cpf: obrigatorio("CPF"),
    sexo: obrigatorio("SEXO"), // "Masculino" ou "Feminino"
    email: obrigatorio("EMAIL"),
    telefone: obrigatorio("TELEFONE"),
    telegramBotToken: obrigatorio("TELEGRAM_BOT_TOKEN"),
    telegramChatId: obrigatorio("TELEGRAM_CHAT_ID"),
    especialidades: carregarEspecialidades(),
  };
}
