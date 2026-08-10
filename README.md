# Monitor de Vagas - Agendamento Médico

Verifica de tempos em tempos um site de agendamento e manda mensagem no Telegram
quando abre uma vaga na especialidade e no período que você configurar. Roda
sozinho na nuvem pelo GitHub Actions, sem precisar deixar o computador ligado.

O site que motivou o projeto é feito em JSF/PrimeFaces, o que trouxe alguns
problemas específicos (campos com máscara, IDs dinâmicos, AJAX que termina depois
do `networkidle`). As soluções estão comentadas no código e resumidas na seção
[Detalhes do site](#detalhes-do-site-que-custaram-tempo).

## Stack

Node.js 22 · Playwright · GitHub Actions · API do Telegram

```
src/
  index.js                  orquestra o ciclo: login, verificação, alerta, estado
  login.js                  formulário inicial e o modal de encaminhamentos
  verificarEspecialidade.js dropdown, leitura da grade de datas e dos horários
  telegram.js               envio e formatação da mensagem
  state.js                  controle de "essa vaga eu já avisei"
  screenshot.js             captura de erro com os campos mascarados
  config.js                 variáveis de ambiente e lista de especialidades
```

## Rodar localmente

```bash
npm install
npx playwright install --with-deps chromium
cp .env.example .env          # preencha com os seus dados
cp config/especialidades.example.json config/especialidades.json
node -r dotenv/config src/index.js
```

O `.env` e o `config/especialidades.json` estão no `.gitignore` e não devem ser
commitados.

Em `config/especialidades.json` vai a lista do que monitorar. Dá pra acrescentar
quantas quiser sem mexer em código:

```json
[
  { "nome": "CARDIOLOGIA", "dataInicio": "2026-01-01", "dataFim": "2026-03-31" },
  { "nome": "DERMATOLOGIA", "dataInicio": "2026-02-01", "dataFim": "2026-02-28" }
]
```

O `nome` precisa ser exatamente igual ao que aparece no site.

## Rodar sozinho no GitHub Actions

Em **Settings → Secrets and variables → Actions**, aba **Secrets**, crie estes
como **Repository secrets**. Não use "Environment secrets": o job não declara
`environment:`, então eles chegariam vazios e a execução falharia com "variável
de ambiente obrigatória não definida".

| Secret | O que é |
|---|---|
| `AGENDA_URL` | URL da tela de agendamento do convênio |
| `CONVENIO` | como o convênio aparece na tela |
| `MATRICULA` | sua matrícula |
| `NOME_COMPLETO` | seu nome completo |
| `DATA_NASCIMENTO` | no formato que o site pede |
| `CPF` | seu CPF |
| `SEXO` | `Masculino` ou `Feminino` |
| `EMAIL` | seu e-mail |
| `TELEFONE` | seu celular |
| `TELEGRAM_BOT_TOKEN` | token do bot (veja abaixo) |
| `TELEGRAM_CHAT_ID` | seu chat ID (veja abaixo) |
| `ESPECIALIDADES` | a lista JSON em uma linha só |

O `ESPECIALIDADES` é o mesmo conteúdo do arquivo local, em uma linha:

```
[{"nome":"CARDIOLOGIA","dataInicio":"2026-01-01","dataFim":"2026-03-31"}]
```

O workflow já roda a cada 20 minutos. Dá pra disparar na mão em
**Actions → Monitor de vagas → Run workflow**, o que ajuda a testar sem esperar
o cron.

### Primeira execução

Com o `state.json` vazio, tudo que estiver aberto hoje conta como novidade e
chegaria de uma vez no Telegram. Pra evitar isso, a primeira execução pode ser
feita em modo silencioso: marque **sem_alerta** no **Run workflow**, ou rode
local com `SEM_ALERTA=1`. As vagas ficam registradas e a partir daí só chega o
que aparecer de novo.

### Criar o bot do Telegram

1. No Telegram, abra conversa com **@BotFather**.
2. Mande `/newbot` e siga as instruções.
3. Ele devolve um token tipo `123456:ABC-DEF...`, esse é o `TELEGRAM_BOT_TOKEN`.
4. Mande qualquer mensagem pro bot recém-criado, senão ele não consegue te responder.
5. Abra `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates` no navegador.
6. O número em `"chat":{"id":...}` é o `TELEGRAM_CHAT_ID`.

## O que fica fora do repositório

O projeto lida com dado pessoal e roda em repositório público, então três coisas
ficam de fora de propósito:

- **Os dados do formulário** (nome, matrícula, CPF, nascimento, e-mail, telefone)
  só existem como secrets. Os secrets são criptografados e o Actions mascara eles
  no log automaticamente.
- **A lista de especialidades** vai no secret `ESPECIALIDADES`, porque ela conta
  quais exames a pessoa está procurando.
- **O `state.json`**, que o workflow commita a cada execução, guarda só hashes.
  Ele precisa apenas comparar igualdade pra saber se uma vaga já foi avisada,
  nunca precisa ler o valor de volta.

O screenshot de erro que sobe como artifact passa antes por `src/screenshot.js`,
que troca o valor dos campos por bolinhas. O que interessa nele é em que tela o
fluxo parou, e isso continua visível.

## Como funciona o "já avisei essa vaga"

O `state.json` guarda o hash de cada vaga já notificada. Depois de cada execução,
o próprio workflow commita o arquivo atualizado de volta no repositório, então a
mesma vaga não chega de novo a cada 20 minutos, só o que aparece de novo.

O horário fica de fora da chave de propósito. Ele só é buscado depois, e só pras
vagas novas, porque custa uma navegação a mais por vaga. Se entrasse na chave,
toda vaga conhecida mudaria de identidade ao ganhar horário e seria avisada de novo.

## Testes

```bash
npm test
```

Usa o `node:test`, que já vem no Node, sem dependência a mais. Cobrem as funções
puras: a chave de estado e o filtro de vagas novas (`src/state.js`) e a leitura
de configuração (`src/config.js`). O fluxo no site não entra aqui, porque
dependeria do site no ar e de dado real de acesso.

Rodam sozinhos no GitHub Actions a cada push e a cada pull request
(`.github/workflows/testes.yml`).

## Quando algo quebra

O site pode mudar os seletores. Duas ferramentas ajudam:

```bash
# abre o navegador na tela, em câmera lenta, pra acompanhar o fluxo
set HEADLESS=false&& node -r dotenv/config src/index.js

# mostra quantas linhas foram lidas e quantas caíram no período
set DEBUG_VAGAS=1&& node -r dotenv/config src/index.js
```

Quando uma especialidade falha, sai um `erro-<especialidade>.png` na raiz junto
com a URL do momento do erro. Esses arquivos estão no `.gitignore`.

Pra redescobrir seletores do zero, grave o fluxo manualmente:

```bash
AGENDA_URL="https://site-do-convenio.com.br/Agenda" npm run inspecionar
```

## Detalhes do site que custaram tempo

- **Campos com máscara** (matrícula, CPF, telefone) ignoram o `fill()` e ficam
  vazios, e se a digitação começa antes do JS da máscara carregar, os dígitos
  saem fora de ordem. A saída foi `pressSequentially()` com só os dígitos,
  conferindo o resultado e repetindo se não bateu (`src/login.js`).
- **O modal** que abre depois do login tem ID dinâmico (`j_idt294`, `j_idt295`...)
  e o PrimeFaces deixa vários `.ui-dialog` escondidos no HTML desde o
  carregamento. O seletor precisa do `:visible`, senão pega um modal invisível e
  a máscara `.ui-widget-overlay` continua bloqueando os cliques.
- **As especialidades do modal somem do dropdown.** Encaminhamentos e retornos só
  podem ser agendados pelo botão de dentro do modal. Mas estar no modal não quer
  dizer estar fora do dropdown: algumas aparecem nos dois.
- **O dropdown é um autocomplete** e casa por trecho. Sem `exact: true`,
  "CARDIOLOGIA" batia também em "CARDIOLOGIA PEDIATRICA", e o strict mode do
  Playwright recusava a ação, o que fazia a especialidade ser reportada como
  inexistente.
- **"Voltar para a tela anterior" e "Voltar para a tela inicial"** ficam na mesma
  tela. O segundo derruba a sessão. Por isso o seletor usa o nome completo.
- **O AJAX termina depois do `networkidle`.** Em vários pontos foi preciso esperar
  o elemento aparecer em vez de confiar no estado de rede, senão a página era
  lida vazia e a conclusão virava "não tem vaga".

## Frequência

20 minutos é um intervalo razoável pra não sobrecarregar o site. Dá pra mudar no
`cron` do workflow, mas deixar muito agressivo (a cada 1 ou 2 minutos) não faz
sentido pra uma consulta médica e ainda aumenta o risco de bloqueio.

## Nota

Usei IA como apoio durante o desenvolvimento, principalmente para revisão de
código e para entender os pontos mais complicados da interação com o site, como o
comportamento dos campos com máscara e os IDs dinâmicos do PrimeFaces. Os
seletores, as decisões de estrutura e a validação contra o site real foram feitos
e testados por mim.
