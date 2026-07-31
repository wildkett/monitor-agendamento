# Monitor de Vagas - Agendamento Médico

Verifica periodicamente um site de agendamento e manda uma mensagem no
Telegram quando abre uma vaga dentro do período e da especialidade que você
configurar. Roda sozinho na nuvem via GitHub Actions — não precisa deixar
seu computador ligado.

## ⚠️ Antes de tudo: os seletores precisam ser ajustados

O site (`site-do-convenio.com.br`) é um sistema JSF/PrimeFaces: várias telas
só aparecem depois de uma ação via JavaScript (escolher convênio, digitar
matrícula, etc). Eu não consigo abrir esse site num navegador daqui para
descobrir os seletores exatos de cada campo, então marquei com `// TODO`
os dois arquivos que dependem disso:

- `src/login.js` — tela de convênio/matrícula/dados pessoais
- `src/verificarEspecialidade.js` — seleção de especialidade e leitura da agenda

### Como descobrir os seletores certos

1. Instale as dependências (veja seção abaixo).
2. Rode:
   ```bash
   AGENDA_URL="https://site-do-convenio.com.br/Agenda" npm run inspecionar
   ```
3. Uma janela do Chrome abre junto com o **Playwright Inspector**, gravando
   tudo que você clicar.
4. Faça o fluxo manualmente, do jeito que você faria normalmente:
   escolher convênio → digitar matrícula → confirmar dados → escolher
   Cardiologia → abrir a agenda/calendário.
5. O Inspector mostra ao vivo o código correspondente a cada clique
   (ex: `await page.getByLabel('Matrícula').fill('123456')`).
6. Copie esses trechos para dentro das funções `login()` e
   `verificarEspecialidade()`, no lugar dos `TODO`.

Preste atenção especial em como a agenda mostra os horários livres — se é
uma lista/tabela ou um calendário com dias destacados — porque o trecho que
lê as vagas em `verificarEspecialidade.js` depende disso.

## Configurar localmente (para testar)

```bash
npm install
npx playwright install --with-deps chromium
cp .env.example .env
# preencha o .env com seus dados
node -r dotenv/config src/index.js  # ou use um pacote como dotenv-cli
```

## Configurar no GitHub (para rodar sozinho)

1. Crie um repositório novo (pode ser privado — recomendado, já que os
   secrets guardam a sua matrícula e dados pessoais) e suba este projeto.
2. Em **Settings → Secrets and variables → Actions**, crie estes secrets:

   | Secret | Exemplo |
   |---|---|
   | `AGENDA_URL` | `https://site-do-convenio.com.br/Agenda` |
   | `CONVENIO` | `Convênio Exemplo` |
   | `MATRICULA` | sua matrícula do convênio |
   | `NOME_COMPLETO` | seu nome completo |
   | `DATA_NASCIMENTO` | no formato que o site pedir |
   | `CPF` | seu CPF |
   | `SEXO` | `Masculino` ou `Feminino` |
   | `EMAIL` | seu e-mail |
   | `TELEFONE` | seu celular |
   | `TELEGRAM_BOT_TOKEN` | token do seu bot (veja abaixo) |
   | `TELEGRAM_CHAT_ID` | seu chat ID (veja abaixo) |

3. O workflow em `.github/workflows/monitor.yml` já está configurado para
   rodar a cada 20 minutos automaticamente. Você também pode disparar uma
   execução manual pela aba **Actions → Monitor de vagas → Run workflow**
   (bom para testar sem esperar o cron).

### Criar o bot do Telegram

1. No Telegram, abra uma conversa com **@BotFather**.
2. Mande `/newbot` e siga as instruções (nome + username do bot).
3. Ele te dá um token tipo `123456:ABC-DEF...` — isso é o `TELEGRAM_BOT_TOKEN`.
4. Mande **qualquer mensagem** para o seu bot recém-criado (senão ele não
   consegue te responder).
5. Acesse no navegador:
   `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates`
6. Procure o campo `"chat":{"id":...}` na resposta — esse número é o
   `TELEGRAM_CHAT_ID`.

## Adicionar outras especialidades no futuro

Edite `config/especialidades.json` e adicione um item novo — não precisa
mexer em código:

```json
[
  {
    "nome": "Cardiologia",
    "dataInicio": "2026-07-28",
    "dataFim": "2026-08-05"
  },
  {
    "nome": "Dermatologia",
    "dataInicio": "2026-09-01",
    "dataFim": "2026-09-15"
  }
]
```

O `nome` precisa ser exatamente igual ao valor usado no site (o que você
selecionar durante a gravação com `playwright codegen`).

## Como funciona o controle de "já avisei essa vaga"

O arquivo `state.json` guarda quais vagas já geraram alerta. Depois de cada
execução, o próprio workflow do GitHub Actions commita esse arquivo
atualizado de volta no repositório — assim você não recebe a mesma vaga
repetida a cada 20 minutos, só quando surge algo novo.

## Sobre frequência e uso responsável

20 minutos é um intervalo razoável para não sobrecarregar o site. Dá pra
ajustar no `cron` do workflow, mas evite deixar muito agressivo (tipo a
cada 1-2 minutos) — é só uma consulta médica, não precisa disso, e reduz o
risco de a plataforma bloquear o acesso automatizado.
