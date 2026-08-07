# Monitor de Vagas - Agendamento Médico

Verifica periodicamente um site de agendamento e manda uma mensagem no
Telegram quando abre uma vaga dentro do período e da especialidade que você
configurar. Roda sozinho na nuvem via GitHub Actions — não precisa deixar
seu computador ligado.

## Configurar localmente (para testar)

```bash
npm install
npx playwright install --with-deps chromium
node -r dotenv/config src/index.js
```

Crie um arquivo `.env` na raiz com as variáveis abaixo, preenchendo com os
seus dados. Ele está no `.gitignore` e nunca deve ser commitado — são os
mesmos valores que vão nos secrets do GitHub (veja a tabela adiante).

```
AGENDA_URL=https://site-do-convenio.com.br/Agenda
CONVENIO=Convênio Exemplo
MATRICULA=
NOME_COMPLETO=
DATA_NASCIMENTO=
CPF=
SEXO=
EMAIL=
TELEFONE=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### Se algo quebrar

O site é JSF/PrimeFaces e pode mudar os seletores. Duas ferramentas ajudam:

```bash
# abre o Chrome na tela, em câmera lenta, para acompanhar o fluxo
set HEADLESS=false&& node -r dotenv/config src/index.js

# mostra quantas linhas foram lidas e quantas caíram no período
set DEBUG_VAGAS=1&& node -r dotenv/config src/index.js
```

Quando uma especialidade falha, um `erro-<especialidade>.png` é salvo na
raiz junto com a URL do momento do erro. Esses screenshots mostram seus
dados pessoais preenchidos, por isso `erro-*.png` está no `.gitignore`.

Para redescobrir seletores do zero, grave o fluxo manualmente:

```bash
AGENDA_URL="https://site-do-convenio.com.br/Agenda" npm run inspecionar
```

Dois detalhes desse site que já custaram tempo e vale conhecer:

- **Campos com máscara** (CPF e Telefone) ignoram `fill()` e ficam vazios —
  o formulário então não valida e o "Avançar" não sai da tela inicial. Use
  `pressSequentially()` com apenas os dígitos, como em `src/login.js`.
- **O modal** que abre após o login tem ID dinâmico (`j_idt294`,
  `j_idt295`...), e o PrimeFaces deixa vários `.ui-dialog` escondidos no
  HTML desde o carregamento. O seletor precisa do `:visible`, senão pega um
  modal invisível e a máscara `.ui-widget-overlay` continua bloqueando os
  cliques da tela seguinte.

## Configurar no GitHub (para rodar sozinho)

1. Crie um repositório **privado** e suba este projeto.

   Isso não é opcional. Os secrets em si são criptografados e não vazariam
   nem em repositório público — o problema são outros dois arquivos:

   - Quando uma execução falha, o workflow publica `erro-debug.png` como
     artifact. Esse screenshot mostra o formulário preenchido, com nome
     completo, matrícula, CPF, data de nascimento, e-mail e telefone
     legíveis. Em repo público, artifacts são baixáveis por qualquer pessoa.
   - O `state.json` é commitado a cada execução e revela quais exames e
     especialidades você acompanha.

2. Em **Settings → Secrets and variables → Actions**, aba **Secrets**, crie
   estes como **Repository secrets** (não "Environment secrets" — o job não
   declara `environment:`, então secrets de environment chegariam vazios e a
   execução falharia com "variável de ambiente obrigatória não definida"):

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
