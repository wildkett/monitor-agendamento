import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PASTA_CONFIG = join(__dirname, "..", "config");
const ARQUIVO_LOCAL = join(PASTA_CONFIG, "especialidades.json");
const ARQUIVO_EXEMPLO = join(PASTA_CONFIG, "especialidades.example.json");

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

function validarLista(lista, origem) {
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new Error(`${origem} precisa ser uma lista com pelo menos uma especialidade.`);
  }

  for (const item of lista) {
    if (!item.nome || !item.dataInicio || !item.dataFim) {
      throw new Error(
        `Cada especialidade precisa de "nome", "dataInicio" e "dataFim". ` +
          `Item inválido (${origem}): ${JSON.stringify(item)}`
      );
    }
  }

  return lista;
}

// A lista de especialidades diz quais exames a pessoa está procurando, então
// ela não fica versionada. No GitHub Actions vem do secret ESPECIALIDADES; na
// máquina, de config/especialidades.json, que está no .gitignore. O arquivo de
// exemplo só existe para o projeto rodar em quem acabou de clonar.
export function carregarEspecialidades() {
  const doAmbiente = (process.env.ESPECIALIDADES ?? "").trim();

  if (doAmbiente) {
    let lista;
    try {
      lista = JSON.parse(doAmbiente);
    } catch {
      throw new Error("ESPECIALIDADES não é um JSON válido. Precisa ser a lista em uma linha só.");
    }
    return validarLista(lista, "o secret ESPECIALIDADES");
  }

  if (existsSync(ARQUIVO_LOCAL)) {
    return validarLista(
      JSON.parse(readFileSync(ARQUIVO_LOCAL, "utf-8")),
      "config/especialidades.json"
    );
  }

  console.warn(
    "Sem ESPECIALIDADES e sem config/especialidades.json: usando o arquivo de " +
      "exemplo. Copie especialidades.example.json para especialidades.json e edite."
  );
  return validarLista(
    JSON.parse(readFileSync(ARQUIVO_EXEMPLO, "utf-8")),
    "config/especialidades.example.json"
  );
}

export function carregarConfig() {
  return {
    agendaUrl: obrigatorio("AGENDA_URL"),
    convenio: obrigatorio("CONVENIO"), // como aparece na tela, ex: "Particular"
    matricula: obrigatorio("MATRICULA"),
    nomeCompleto: obrigatorio("NOME_COMPLETO"),
    dataNascimento: obrigatorio("DATA_NASCIMENTO"), // no formato do site, DD/MM/AAAA
    cpf: obrigatorio("CPF"),
    sexo: obrigatorio("SEXO"), // "Masculino" ou "Feminino"
    email: obrigatorio("EMAIL"),
    telefone: obrigatorio("TELEFONE"),
    telegramBotToken: obrigatorio("TELEGRAM_BOT_TOKEN"),
    telegramChatId: obrigatorio("TELEGRAM_CHAT_ID"),
    especialidades: carregarEspecialidades(),
  };
}
