# Deco Dashboard

Painel web para gerenciar uma rede mesh **TP-Link Deco** pela API local do
roteador: nós, clientes, inventário, reservas de DHCP, plano de IPs, histórico,
alertas e backup. Roda num container na sua LAN.

Testado com um mesh de 6 nós com Deco X50 (gateway) e M5. A comunicação com o
Deco usa o cliente do [deco-mcp](https://github.com/fullo/deco-mcp) (MIT, de
Francesco Fullone; ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

> [!WARNING]
> **Não exponha este painel à internet.** Ele guarda a senha de administrador
> do Deco e, com `DECO_ALLOW_WRITE=1`, altera o roteador. A proteção por
> `UI_PASSWORD` é uma senha única, sem usuários nem 2FA, pensada para a LAN.
> Para acesso de fora, use uma VPN (WireGuard, Tailscale) — nunca um
> redirecionamento de porta.

## O que faz

| Tela | O quê |
|---|---|
| Visão geral | Nós (modelo, firmware, backhaul, sinal do uplink, online desde), internet/WAN, Wi-Fi, CPU/memória, totais por banda; reiniciar nó (com `DECO_ALLOW_DANGEROUS=1`) |
| Clientes | Online e offline já vistos, filtros, IP, nó, banda, taxa atual, primeira/última vez, fabricante pelo MAC; "Fixar IP" |
| Reservas | Reservas de DHCP do Deco: criar, mudar IP, remover (com `DECO_ALLOW_WRITE=1`) |
| Inventário | Apelido, dono, tipo, tags, notas; vários MACs num mesmo dispositivo (cabo + Wi-Fi) |
| Plano de IPs | Faixas nomeadas (`.8/29`, `.20-.39`, `.100+`), mapa do /24, anomalias, próximo IP livre |
| Histórico | Eventos (novo, conectou, desconectou, IP mudou, nó/internet caiu, reservas mudadas fora do painel), gráfico de clientes online, auditoria |
| Alertas | Dispositivo novo, nó offline, internet fora — por ntfy e/ou Telegram; aprovação de dispositivos |
| Backup | Exporta reservas + inventário + plano em JSON; importa com pré-visualização do que muda |

## Instalação (Docker / Podman)

```sh
git clone <este repositório> deco-web && cd deco-web
mkdir -p secrets
printf '%s' 'senha-admin-do-deco' > secrets/deco_password
printf '%s' 'senha-para-abrir-o-painel' > secrets/ui_password
chmod 700 secrets && chmod 644 secrets/*
cp compose.override.example.yaml compose.override.yaml
# Ajuste DECO_HOST no compose.yaml e o resto no compose.override.yaml, depois:
docker compose up -d --build        # ou: podman compose up -d --build
```

**Permissões dos segredos.** O container roda como o usuário `node` (uid
1000), que precisa ler os arquivos. No Podman rootless (e no Docker, quando o
seu uid não é 1000), um arquivo `600` do seu usuário fica ilegível lá dentro e
o painel não sobe.
Por isso os arquivos ficam `644` e a **pasta** `secrets/` fica `700`: só você
entra nela. Os nomes têm de ser exatamente `deco_password` e `ui_password`.

**Ajustes locais.** O `compose.override.yaml` (fora do git) guarda o que é só
da sua instalação: escrita habilitada, tópico do ntfy, `PUBLIC_URL`, token do
Prometheus. O compose mescla os dois arquivos sozinho, e um `git pull` nunca
conflita com a sua configuração.

**Atualizar.** `git pull && podman compose up -d --build --force-recreate`.
Sem `--force-recreate`, o podman-compose gera a imagem nova mas deixa o
container antigo rodando. O encerramento espera o poll em andamento deslogar
do Deco, então pode levar até um minuto.

Abra `http://<ip-da-máquina>:8080`. O primeiro poll leva uns 15–40 s.

O [`compose.yaml`](compose.yaml) já vem com: senhas por Docker secrets
(`*_FILE`), usuário sem privilégios, sistema de arquivos somente leitura,
`cap_drop: ALL`, volume `/data` e `stop_grace_period: 75s`. Ligue a porta só
ao IP da máquina na LAN (`"192.168.68.10:8080:8080"`) se ela tiver outras
interfaces.

Com **Podman**, construa em formato Docker para o healthcheck valer:
`podman build --format docker -t deco-web .`

### Sem container

Node 20 ou mais novo:

```sh
npm ci
npm run build
DECO_HOST=192.168.68.1 DECO_PASSWORD='…' UI_PASSWORD='…' DATA_DIR=./data npm start
```

## Variáveis de ambiente

Toda variável de segredo aceita `NOME_FILE` apontando para um arquivo (Docker
secrets). Segredos nunca vão para o banco, para os logs ou para o navegador.

### Deco

| Variável | Padrão | |
|---|---|---|
| `DECO_HOST` | — | IP do Deco principal, ex.: `192.168.68.1`. Obrigatória (exceto com `DECO_MOCK=1`) |
| `DECO_PASSWORD` / `_FILE` | — | Senha de administrador do Deco (a mesma do app) |
| `DECO_USERNAME` | `admin` | O firmware não tem usuário de verdade; deixe `admin` |
| `POLL_INTERVAL` | `90` | Segundos entre leituras. Mínimo 30: cada leitura abre uma sessão admin |
| `POLL_DETAIL_EVERY` | `5` | A cada N leituras, lê também cliente→nó, Wi-Fi e CPU (mais lento) |
| `DECO_TIMEOUT_MS` | `15000` | Timeout de cada chamada HTTP ao Deco |
| `DECO_SESSION_GAP_MS` | `10000` | Pausa mínima entre sessões consecutivas (ver Limitações) |
| `DECO_ALLOW_WRITE` | `0` | `1` habilita escrita: reservas de DHCP |
| `DECO_ALLOW_DANGEROUS` | `0` | `1` habilita reiniciar nós (ver [Operações perigosas](#operações-perigosas-reiniciar-e-wi-fi)). Exige `DECO_ALLOW_WRITE=1` |
| `DECO_EXPERIMENTAL_WIFI_WRITE` | `0` | `1` mostra "Alterar…" no Wi-Fi. **O X50 recusa** o formato usado; só para testar outros firmwares. Exige `DECO_ALLOW_DANGEROUS=1` |
| `DECO_MOCK` | `0` | `1` usa dados de exemplo anonimizados, sem roteador (demonstração) |

### Painel

| Variável | Padrão | |
|---|---|---|
| `UI_PASSWORD` / `_FILE` | — | Senha da interface. Sem ela, qualquer um na rede abre o painel (aviso no log) |
| `PORT` / `BIND` | `8080` / `0.0.0.0` | Porta e endereço HTTP |
| `DATA_DIR` | `/data` | Onde fica o SQLite |
| `HISTORY_RETENTION_DAYS` | `90` | Eventos, amostras e alertas mais velhos são apagados |
| `EVENT_DISCONNECT_GRACE` | `300` | Segundos de ausência antes de registrar "desconectou" (celular em repouso some e volta) |
| `LOG_LEVEL` | `info` | `debug` mostra o tempo de cada chamada ao Deco |
| `TZ` | UTC | Fuso dos horários nas notificações, ex.: `America/Sao_Paulo` |
| `PUBLIC_URL` | — | URL do painel, para a notificação abrir o painel ao ser tocada |
| `METRICS_TOKEN` / `_FILE` | — | Token Bearer para o Prometheus ler `/metrics` (ver [Prometheus](#prometheus)) |

### Alertas

| Variável | Padrão | |
|---|---|---|
| `NOTIFY_NTFY_URL` | — | URL do tópico, ex.: `https://ntfy.sh/um-topico-dificil` ou um ntfy na sua LAN |
| `NOTIFY_NTFY_TOKEN` / `_FILE` | — | Token de acesso, se o servidor ntfy exigir |
| `NOTIFY_TELEGRAM_TOKEN` / `_FILE` | — | Token do bot (do @BotFather) |
| `NOTIFY_TELEGRAM_CHAT_ID` | — | Chat que recebe; vai junto com o token |
| `ALERT_NEW_DEVICE` | `1` | Alerta de MAC nunca visto e não aprovado |
| `ALERT_NODE_OFFLINE_MINUTES` | `5` | Nó fora por mais que isso; `0` desliga |
| `ALERT_INTERNET_DOWN_MINUTES` | `3` | Internet fora por mais que isso; `0` desliga |

Sem canal configurado, os alertas aparecem só na tela de Alertas.

## Personalização, favoritos e diagnóstico

Em **Configurações → Aparência**, escolha Profissional Claro, Catppuccin Latte,
Catppuccin Mocha, Dracula ou Profissional Escuro (grafite). Automático acompanha o
sistema entre Profissional Claro e Profissional Escuro. As paletas vêm de
[Catppuccin](https://catppuccin.com/palette/) e
[Dracula](https://draculatheme.com/spec), adaptadas aos componentes do painel.
Os profissionais aparecem juntos na lista e usam acabamento clássico inspirado
no Windows NT: cantos retos, cores sólidas, bordas definidas e controles com
relevo discreto. Catppuccin e Dracula preservam suas identidades.
Densidade compacta reduz tabelas/listas no desktop; animações podem seguir o
sistema ou ser reduzidas. Preferências antigas de claro/escuro são migradas.
A rota antiga `#/aparencia` leva à nova página. Fotos padrão por modelo são
opcionais: arquivos `deco-<modelo>.png` (ou `.jpg`/`.webp`) em
`web/src/art/decos/` entram no build e são usados por padrão, inclusive nos
mapas. Eles ficam **fora do git** — as fotos oficiais têm direitos da TP-Link —,
então builds do CI/release não as trazem. Uma imagem personalizada tem
prioridade; removê-la restaura a foto padrão. Sem foto padrão, o modelo usa o
desenho SVG com status.

Configurações também mostra atualização, alertas, sistema e dados. Os valores
operacionais são **somente consulta**, definidos no ambiente do servidor.
Temas e filtros são locais ao navegador e sincronizados entre abas. Clientes
lembra filtros, ordenação e visualização; Inventário lembra busca, tipo e
favoritos; Histórico lembra tipos de eventos e períodos. Limpar filtros ou
restaurar preferências locais não altera os cadastros compartilhados.

Favoritos são compartilhados, podem ser alternados no inventário ou ficha e
aparecem na visão geral com as interfaces e o link de gerenciamento. O estado
online do cadastro considera todos os seus MACs. Favoritos entram no backup;
arquivos antigos sem esse campo preservam os valores locais. Na mesclagem,
se o cadastro de origem desaparecer, seu favorito é preservado no destino.
Separar uma interface não a torna favorita automaticamente.

A aba **Histórico** da ficha reúne eventos dos MACs atuais do cadastro, com
paginação. Mudanças de nó só são registradas quando uma nova coleta detalhada
confirma a mudança entre nós conhecidos e a interface permaneceu observada
pelo Deco. Não são reconstruídas mudanças anteriores. Presença confirmada pelo
painel via ARP é identificada; banda, nó e taxas não são inventados a partir
dessa observação. Os horários representam observações periódicas.

**Configurações → Atualização** exibe o diagnóstico: duração total da tentativa,
incluindo espera na fila e complementação local, média, sucessos e falhas. Até
200 tentativas concluídas ficam no SQLite, com as últimas 100 na tela. Pausas
e bloqueios que impedem iniciar uma consulta não contam como falhas. O histórico
de diagnóstico persiste entre reinícios e não entra no backup de cadastros.

Endpoints autenticados como as demais APIs:

- `GET /api/settings`: projeção explícita de valores efetivos, versão,
  capacidades e indicadores de canais configurados; sem credenciais ou URLs
  de notificação.
- `GET /api/diagnostics/polls`: últimas 100 tentativas e resumo, sem respostas
  brutas nem mensagens de erro privadas.
- As APIs de dispositivos e o backup aceitam `favorite: boolean`; a API de
  eventos inclui `client_node_changed` com nó anterior e atual.

Essas consultas usam cache/SQLite e não abrem sessões no Deco. A frequência da
coleta e as proteções de acesso permanecem inalteradas.

## Links de gerenciamento

No cadastro do dispositivo, **URL de gerenciamento** aceita um endereço completo
HTTP/HTTPS com IP ou hostname, porta e caminho (ex.: `https://nas.local:5001/`).
O link **Abrir gerenciamento** aparece no inventário e na ficha do cliente, em
outra aba. Campo vazio remove o endereço; credenciais na URL não são aceitas.
O painel apenas guarda o link: não descobre portas nem consulta esse endereço.
Exportação e restauração incluem o campo; backups antigos sem ele preservam o
link dos dispositivos existentes.

## Frequência e idade dos dados

A interface já usa SSE para receber mudanças assim que a coleta termina.
Isso não torna a coleta do equipamento em tempo real: o acesso inspecionado é
por consultas periódicas, sem canal de eventos do Deco identificado no código.

`POLL_INTERVAL=90` é a espera **após** terminar cada coleta, não o período entre
inícios. Com os ~13 s por leitura relatados abaixo, o ciclo seria ~103 s.
Essa é uma estimativa, sem nova medição da instalação atual; duração, filas,
falhas e pausas podem aumentar a espera.

Cada coleta lê nós, lista geral de clientes, reservas, internet e WAN. Já a
associação cliente→nó, configuração Wi-Fi e CPU/memória são lidas na primeira
coleta e, depois, a cada `POLL_DETAIL_EVERY=5` ciclos; entre elas o painel reutiliza
os detalhes anteriores. Com ciclos de ~103 s, detalhes podem ter cerca de
8,6 minutos entre atualizações. Clientes e taxas vêm da lista geral a cada ciclo,
mas a relação com os nós pode continuar desatualizada até a coleta detalhada.

Alternativas, sem alteração da configuração neste pedido:

- `POLL_INTERVAL=60`: ciclo estimado de ~73 s.
- `POLL_INTERVAL=30`: mínimo permitido; ciclo estimado de ~43 s.
- `POLL_DETAIL_EVERY` menor: detalhes mais frequentes, com mais chamadas e
  possível aumento da duração da coleta.

Diminuir a espera gera mais logins administrativos e pode interferir mais no
aplicativo Deco. A fila única, sessões curtas e circuit breaker devem ser
preservados. Consultar o cache mais vezes no navegador não acelera a coleta.

**Melhoria sugerida:** a barra de status já mostra a idade da coleta, dos detalhes
e avisos de dados antigos. Tornar a próxima coleta mais visível e explicar quais
campos dependem dos detalhes ajudaria a distinguir informação antiga de um
aparelho offline. Sugestão para evolução futura, sem mudança nesta entrega.

## Como ele fala com o Deco

O Deco aceita **uma única sessão de administrador por vez**: enquanto o painel
está logado, o app do celular é desconectado (e vice-versa). Por isso:

- **Sessões curtas.** Cada leitura é login → leituras → logout, sempre. Nenhuma
  sessão fica aberta. Num X50 medimos ~13 s por leitura (login 6–17 s).
- **A interface nunca fala com o Deco.** Ela lê o cache do último poll; o botão
  "Atualizar" pede um poll e tem intervalo mínimo de 30 s. A tela se atualiza
  sozinha: o servidor avisa por Server-Sent Events (`/api/live`) quando um poll
  termina ou alguém altera algo, e a UI relê só o que mudou. Atrás de um proxy
  reverso, desligue o buffer de resposta para essa rota.
- **Uma fila só.** Leituras e escritas passam pela mesma fila: nunca há duas
  chamadas ao Deco ao mesmo tempo.
- **Proteção contra bloqueio.** O Deco bloqueia o login depois de ~10 senhas
  erradas. O painel para de tentar após 3 falhas de login (ou quando o Deco
  informa 5 tentativas restantes) e **trava** até alguém destravar. Outras
  falhas (rede, Deco ocupado) esperam 60 s, dobrando até 1 h. Nunca há
  tentativas em loop.
- **Escritas verificadas.** Cada alteração de reserva relê a lista no Deco,
  escreve uma vez e relê para confirmar. Se a resposta se perde, nada é
  reenviado: o resultado aparece como "incerto" e o painel faz uma leitura
  completa. Toda escrita pede confirmação na interface e vai para a auditoria
  (quem, quando, antes, depois, resultado).

### Destravar após falha de login

Corrija a senha e, com o painel rodando, clique em **Destravar** na barra de
status. Com o painel parado:

```sh
docker compose run --rm deco-web node dist/unlock.js   # container
npm run unlock                                          # desenvolvimento
```

## Operações perigosas: reiniciar e Wi-Fi

Com `DECO_ALLOW_WRITE=1` **e** `DECO_ALLOW_DANGEROUS=1`, a Visão geral ganha
"Reiniciar…" em cada nó.

**Alterar Wi-Fi é experimental e fica escondido.** Com
`DECO_EXPERIMENTAL_WIFI_WRITE=1`, cada rede (principal, convidados, IoT) ganha
"Alterar…": ligar/desligar, nome (SSID) e senha. O formato enviado é
`admin/wireless?form=wlan`, operação `write`, só com os campos que mudam, igual
a outros clientes do Deco. **No X50 (firmware 1.x) ele é recusado**: o script
do firmware quebra com `attempt to index global 'mode' (a nil value)` e nada
muda (testado; o painel releu e confirmou). O formato que o app usa ainda não é
conhecido. Ver [Descobrir o que o Deco espera](#descobrir-o-que-o-deco-espera).

**Pode estragar ("bricar") o Deco?** Não. Bricar acontece quando a gravação do
firmware é interrompida no meio. Nenhuma das duas operações toca no firmware:

- **Reiniciar** é o mesmo que o botão do app: o nó desliga e volta em 2–4
  minutos, com a configuração intacta. O único cuidado é **não reiniciar
  durante uma atualização de firmware** — e isso vale para o app também.
- **Alterar o Wi-Fi** muda configuração, igual ao app. O pior caso não é um
  Deco estragado, e sim **perder o acesso**: trocar a senha da rede principal
  derruba todos os aparelhos até que cada um receba a senha nova (os de IoT
  costumam exigir reconfiguração um a um); se o painel ou o seu computador
  estiver no Wi-Fi, a conexão cai junto. Você continua podendo entrar por cabo
  ou pelo app do Deco, que fala com o roteador pela nuvem. Em último caso, o
  botão de reset (segurar até o LED mudar de cor) volta o Deco ao padrão de fábrica, mas aí o
  mesh precisa ser configurado de novo pelo app.

O que o painel faz para evitar estrago:

- **Confirmação** na interface para tudo, e confirmação **digitada** para o
  que derruba a casa inteira: reiniciar o gateway e mexer na rede principal.
- A **rede principal não pode ser desligada** pelo painel, só renomeada ou com
  a senha trocada.
- **Nada é reenviado.** Um reinício sem resposta (o gateway costuma cair antes
  de responder) aparece como "incerto". Cada nó só pode ser reiniciado de novo
  depois de **5 minutos**. Depois de reiniciar o gateway, as leituras param por
  3 minutos, para não acumular falhas no circuit breaker.
- **Wi-Fi verificado:** cada alteração lê a configuração atual, envia só os
  campos que mudam, uma vez, e relê para confirmar. Se a resposta se perde, a
  releitura decide; sem releitura, o resultado é "incerto".
- **SSID e senha em base64**, como o firmware do X50 guarda (verificado lendo
  o próprio aparelho); a codificação segue a do valor atual.
- **A senha do Wi-Fi não fica guardada.** Ela passa do navegador direto para o
  Deco: não vai para o banco, para os logs nem para a auditoria, que registra
  só "senha trocada".

O endpoint de reinício vem do deco-mcp (`admin/device?form=system`, operação
`reboot`). **Testado num X50** reiniciando um satélite no cabo: o Deco aceitou
o pedido, o nó sumiu na leitura seguinte e voltou em cerca de 3 minutos, sem
afetar os outros nós e sem falha de acesso no painel. O reinício do gateway
(confirmação digitada e pausa de 3 minutos nas leituras) ainda não foi testado
num aparelho real.

### Descobrir o que o Deco espera

O app do celular não usa esta API: ele fala com o Deco pelo protocolo TMP,
num túnel SSH (porta 20001) ou pela nuvem da TP-Link. Capturar esse tráfego
exige celular com root e quebrar o SSH, então não é um caminho prático.

O caminho viável é a **interface web local** (`https://192.168.68.1`), que usa
a mesma API do painel. Se ela permitir alterar o Wi-Fi no seu firmware, dá
para ver o pedido **antes** de ser cifrado:

1. Pare o painel (`podman stop deco-web`): o Deco aceita uma sessão admin por
   vez.
2. Abra `https://192.168.68.1` no Chrome/Firefox, faça login e abra as
   ferramentas de desenvolvedor (F12).
3. Em *Sources*/*Depurador*, busque (Ctrl+Shift+F) por `operation` ou
   `encrypt` nos scripts da página e ponha um breakpoint na função que cifra
   os dados antes do envio (costuma receber um objeto com `operation` e
   `params`).
4. Faça a alteração na interface (comece pela rede de convidados). Quando o
   breakpoint parar, copie o objeto em texto puro e **apague a senha** antes
   de compartilhar.
5. Feche a sessão da interface e suba o painel de novo.

Com o JSON real, dá para ajustar `src/deco-client/system.ts`.

## Prometheus

`GET /metrics` (formato texto do Prometheus) sai inteiro do cache: um scrape
nunca abre sessão no Deco, então o intervalo de scrape pode ser qualquer um.
Os valores mudam no ritmo do `POLL_INTERVAL`.

| Métrica | |
|---|---|
| `deco_up` | 1 se o último poll deu certo e o snapshot é recente |
| `deco_last_success_timestamp_seconds`, `deco_breaker_state{state}`, `deco_poll_paused` | Saúde do acesso ao Deco |
| `deco_node_up{mac,name,model,role}`, `deco_node_info{mac,firmware,ip}` | Nós do mesh |
| `deco_node_clients{mac,name}`, `deco_node_uplink_signal{mac,name,band}` | Carga e sinal do uplink por nó |
| `deco_clients{band}`, `deco_clients_by_network{network}` | Clientes online |
| `deco_client_up_bytes_per_second{mac,name}`, `deco_client_down_bytes_per_second{mac,name}` | Taxa instantânea por cliente (o Deco não tem contador acumulado) |
| `deco_internet_up{family}`, `deco_cpu_ratio`, `deco_memory_ratio` | Internet e gateway |
| `deco_reservations`, `deco_reservations_max`, `deco_wifi_enabled{network,band,ssid}` | Configuração |

O nome dos clientes usa o apelido do inventário quando existe.

**Acesso.** Com `UI_PASSWORD` definido, `/metrics` exige o token de
`METRICS_TOKEN` (ou uma sessão da UI). Esse token só abre `/metrics`, não a
API. Para gerar um token:

```sh
openssl rand -hex 24 > secrets/metrics_token && chmod 644 secrets/metrics_token
```

Descomente as linhas de `metrics_token` no `compose.override.yaml` e, no
Prometheus:

```yaml
scrape_configs:
  - job_name: deco
    scrape_interval: 60s
    authorization:
      credentials_file: /etc/prometheus/deco_metrics_token
    static_configs:
      - targets: ["192.168.68.X:8080"]
```

## Limitações (firmware do Deco)

Encontradas no X50 / M5; podem variar por modelo e firmware.

- **Faixa e DNS do DHCP só pelo app.** A API local não expõe o pool nem os
  leases. O Plano de IPs documenta e confere, mas não altera o pool; "em uso"
  vem da lista de clientes.
- **Sem sinal por cliente, sem uptime e sem tráfego acumulado.** O tráfego
  exibido é a taxa no instante da leitura. "Online desde" e "primeira vez"
  contam a partir de quando o painel começou a registrar.
- **Sessões coladas derrubam a conexão.** Logar logo após o logout anterior deu
  `ECONNRESET` no X50; daí a pausa de `DECO_SESSION_GAP_MS`.
- **Reservas só por remove + add.** Mudar o IP de uma reserva remove e recria;
  se a recriação falhar, o painel restaura a antiga e avisa.
- **Reserva só vale na renovação.** O aparelho passa a usar o IP reservado ao
  renovar o lease (reconectar acelera); até lá, aparece como "aguardando
  renovação".
- **O app do Deco é desconectado** sempre que o painel abre uma sessão.
- **Bloqueio de dispositivos não está no painel.** No M9 Plus o deco-mcp
  constatou que a API local recusa o bloqueio; no X50 não foi testado.

## Backup

A tela **Backup** exporta reservas, inventário e plano de IPs (sem senhas, PSK
ou histórico). A importação mostra o que muda, seção por seção, e **só
acrescenta ou atualiza — nunca apaga**. Reservas vêm desmarcadas por padrão,
exigem `DECO_ALLOW_WRITE=1` e são recusadas se o backup for de outra rede.

O banco inteiro (histórico incluído) está em `/data/deco-web.sqlite`. Para
copiá-lo com o painel rodando: `sqlite3 /data/deco-web.sqlite ".backup cópia.sqlite"`.

## Imagens

A tela **Aparência** troca os desenhos por imagens suas: dos modelos Deco, de
cada categoria de aparelho e de aparelhos do inventário (pela ficha do
aparelho). Tudo fica em `DATA_DIR/images` (`decos/`, `categories/`,
`devices/`), fora do git; PNG, JPEG e WebP, e SVG só para os modelos Deco
(sanitizado, com o LED ligado ao nó — veja "Enviar seu próprio SVG").

- **Buscar fotos oficiais** lê a página de produto de cada modelo no site da
  TP-Link, escolhe uma foto de uma unidade quando consegue e tira o fundo
  branco no navegador. **Escolher foto → Buscar fotos oficiais** mostra a galeria inteira para você
  escolher. O servidor só baixa de `static.tp-link.com` e precisa de internet.
- Sem a interface: `npm run fetch-images` (ou, no container,
  `docker compose run --rm deco-web node dist/fetch-images.js`) baixa uma foto
  por modelo do último snapshot, sem remover o fundo.

As fotos oficiais têm direitos autorais da TP-Link: são para uso pessoal no
seu painel e não devem ser commitadas nem redistribuídas.

## Planta da casa

A tela **Casa** mostra os Decos sobre a planta baixa: envie uma imagem da
planta (em "Posicionar Decos"), arraste cada Deco para onde ele está e informe a
largura real da área em metros. O painel desenha a cobertura estimada de 2,4 e
5 GHz pela distância (modelo log-distance, **sem paredes**: é uma estimativa de
onde o sinal tende a ficar fraco, não uma medição), os aparelhos de cada nó e os
links com o tráfego. A planta fica em `DATA_DIR/images/floorplan/` e as
posições, no banco.

## Desenvolvimento

```sh
npm ci
npm run dev        # backend com dados de exemplo (DECO_MOCK=1) em :8080
npm run dev:web    # frontend com recarga em :5173 (proxy de /api)
npm test           # Vitest
npm run typecheck
```

- `src/deco-client/` — tudo que conhece o formato do Deco: cliente copiado do
  deco-mcp (`vendor/`), parser, implementação real (`live.ts`) e mock.
- `src/core/` — fila, circuit breaker, poller, eventos, plano de IPs, reservas,
  alertas, backup.
- `src/db/` — SQLite (migrações por `user_version`) e repositórios.
- `src/server/` — API (Fastify). `web/` — interface (Preact + Vite).
- `npm run update-oui` atualiza `oui/ieee-oui.tsv.gz`, a base de fabricantes
  por MAC (registros públicos do IEEE). A consulta é local: nenhum MAC sai da
  rede. MACs administrados localmente (celulares com endereço privado, VMs)
  aparecem como "MAC privado". Com o fabricante e a categoria do Deco, o
  inventário sugere o tipo de cada aparelho novo.
- `npm run probe` lista, só com leituras, o que o seu Deco responde; grava
  `probe-output.json` (contém dados da sua rede; está no `.gitignore`).

## Proxmox (com cópias no Synology)

O painel é leve (poucas dezenas de MB de RAM, CPU quase parada) e cabe num
**container LXC** pequeno. Os scripts em `proxmox/` seguem o padrão do
[community-scripts](https://community-scripts.org): usam o mesmo motor
(`community-scripts/core`: menus, criação do CT, motd, comando `update`), com os
scripts deste app vindos deste repositório.

**Instalar** — no shell do Proxmox (nó, não dentro de um CT):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/fcrespo82/deco-web/main/proxmox/ct/deco-web.sh)"
```

Cria um CT Debian 13 sem privilégios (1 vCPU, 512 MB, 4 GB; "Advanced" muda
tudo), instala Node.js 22 e o release mais recente, e pergunta o IP do Deco, a
senha do Deco e uma senha para a interface (vazia = gera uma e mostra no fim).
O painel fica em `http://IP-DO-CT:8080`, rodando nativo (systemd, usuário
`deco-web`), sem Docker.

**Atualizar** — dentro do CT, rode `update` (ou o mesmo comando de instalar,
dentro do CT). Ele confere o release mais novo no GitHub e, se houver:
para o serviço (que espera o poll em andamento deslogar do Deco), faz backup do
banco em `/var/lib/deco-web/backups/` (guarda os 5 últimos), instala, sobe e
confere `/api/health`. Se não subir em 30 s, volta para a versão anterior.

| O quê | Onde |
|---|---|
| Configuração (`DECO_HOST`, escrita, alertas…) | `/etc/deco-web/deco-web.env` → `systemctl restart deco-web` |
| Senhas do Deco e da interface | `/etc/deco-web/deco_password`, `/etc/deco-web/ui_password` |
| Banco, imagens, planta | `/var/lib/deco-web/` |
| Programa | `/opt/deco-web/` (substituído a cada update) |
| Logs | `journalctl -u deco-web -f` |

Use IP fixo para o CT (reserva de DHCP, que dá para fazer pelo próprio painel,
ou IP estático no "Advanced"). Prefere container? A
[instalação com Docker/Podman](#instalação-docker--podman) também funciona num
LXC com `nesting` ligado.

**Onde ficam os dados.** O volume `/data` (SQLite) fica no disco local do LXC,
**nunca em NFS/SMB**: o modo WAL do SQLite depende de travas que
compartilhamentos de rede não garantem, e o banco pode corromper. O Synology
guarda as **cópias**:

- *Backup do LXC inteiro:* em *Datacenter → Storage*, adicione um storage NFS
  apontando para uma pasta do Synology (conteúdo "VZDump backup") e agende um
  backup diário do LXC no modo *snapshot*. Isso leva o banco, os segredos e a
  configuração.
- *Só os dados do painel:* monte uma pasta NFS do Synology no LXC e agende
  `sqlite3 /var/lib/deco-web/deco-web.sqlite ".backup /mnt/synology/deco-web-$(date +%F).sqlite"`,
  ou baixe o JSON da tela Backup.

Uma VM também funciona, mas gasta mais memória para o mesmo resultado.

## Próximos passos (preparado, não implementado)

- **OIDC / SSO.** O caminho previsto é um proxy na frente (oauth2-proxy,
  Authelia, Authentik) e um modo que confie no usuário enviado por ele em vez
  de `UI_PASSWORD`; a auditoria já tem o campo "quem" para registrar o nome.

## Releases

1. Ajuste `version` no `package.json` (ex.: `1.1.0`) e faça o commit.
2. `git tag v1.1.0 && git push origin v1.1.0`.

O workflow `.github/workflows/release.yml` roda typecheck e testes, gera o
pacote com `scripts/package-release.sh` (build pronto, sem `node_modules`) e
publica o release. Os CTs passam a ver a versão nova no próximo `update`.

## Licença

MIT. Inclui código do [deco-mcp](https://github.com/fullo/deco-mcp)
(MIT, © Francesco Fullone) — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Desenho ou foto dos nós

Em **Configurações → Aparência → Escolher foto**, cada modelo permite selecionar
**Desenho com status**, **Foto padrão** (X50/M5/M4R) ou a foto personalizada já
enviada. A escolha é compartilhada, persiste no servidor e não apaga fotos ao
alternar. O SVG conserva seu LED verde/vermelho; a foto usa o indicador
sobreposto. A busca externa por fotos oficiais só ocorre quando solicitada.
Enviar uma nova foto passa a usá-la; remover a personalizada restaura o padrão.

### Como criar um desenho SVG com LED de status

Os desenhos reativos são componentes TSX em `web/src/art/DecoArt.tsx`.
Para usar um SVG seu sem mexer no código, envie o arquivo pelo painel (veja
"Enviar seu próprio SVG" abaixo). Os passos a seguir são para incluir um
desenho novo no próprio projeto.

1. Desenhe o corpo no sistema de coordenadas `viewBox="0 0 64 80"`.
   `x` cresce para a direita e `y` para baixo. O mesmo desenho será escalado
   nos cartões e na topologia: não use pixels da tela para posicionar o LED.
2. Mantenha corpo e LED separados. Localize o centro do LED nas coordenadas
   do desenho e use o componente `DecoStatusLed`, passando `online` e `active`.
3. Acrescente a família ao tipo `DecoShape`, reconheça o modelo em
   `decoShape()` e adicione seu ramo em `DecoShapeSvg()` antes do desenho padrão.
   Por exemplo, use `if (/^EXEMPLO/.test(m)) return "custom"` para uma família
   hipotética `custom`, adicionada ao tipo.
4. Use os gradientes `defs`/`body` e a sombra existentes. Os IDs recebem `uid`
   para evitar conflitos quando há vários nós na mesma tela.

Exemplo de ramo em `DecoShapeSvg` para a família hipotética:

```tsx
if (shape === "custom") {
  return (
    <g>
      {defs}
      {shadow}
      <rect x={14} y={10} width={36} height={64} rx={6}
        fill={`url(#${body})`} />
      <DecoStatusLed cx={32} cy={64} rx={2} ry={1.3}
        online={online} active={active} />
    </g>
  );
}
```

`cx` e `cy` definem o centro; `rx` e `ry` são os raios horizontal e vertical.
Se o LED real estiver mais acima ou ao lado, altere somente essas coordenadas
no mesmo sistema do corpo. Se importar um SVG com outro `viewBox`, normalize
corpo **e LED** para 64×80 ou envolva os dois no mesmo grupo transformado.

Posições dos desenhos atuais:

| Família | Centro do LED | Raios | Exemplos |
| --- | --- | --- | --- |
| Disco (`puck`) | `(32, 44)` | `3.2 × 1.2` | M5/M9/P9 |
| Cilindro (`tall`) | `(32, 63)` | `1.8 × 1.2` | M4/M4R/E4 |
| Torre (`tower`) | `(32, 12)` | `2.6 × 1` | X50/X20/X55 |

`DecoStatusLed` escolhe `--led-on` ou `--led-off` conforme `online`; os temas
definem as cores. Online adiciona pulsação/brilho, respeitando movimento
reduzido. `active` destaca um nó selecionado. O estado vem do dashboard:
não coloque temporizadores, consultas de rede ou uma cor verde fixa no SVG.

Depois, selecione **Desenho com status** em **Configurações → Aparência →
Escolher foto**. Confira online, offline, seleção, movimento reduzido e os
temas claro/escuro, tanto no cartão quanto na topologia. Execute `npm run
typecheck`, `npm test` e `npm run build` antes de entregar.

### Enviar seu próprio SVG

Em **Configurações → Aparência**, use **Enviar** no modelo (ou **Escolher foto →
Enviar outra foto**) e escolha um `.svg`. O diálogo mostra a prévia online e
offline e o que foi removido; **Salvar SVG** passa a usá-lo nos cartões, na
Casa, no modo TV e na topologia.

Requisitos:

- Raiz `<svg>` com `viewBox` (qualquer sistema de coordenadas; o desenho é
  encaixado na mesma caixa dos desenhos internos).
- **Exatamente um** elemento com `id="status-led"`, numa forma (`path`,
  `circle`, `ellipse`, `rect`, `polygon`…) ou num `<g>`. O painel troca o
  preenchimento dele (e das formas dentro do `<g>`) por `--led-on`/`--led-off`
  do tema, adiciona a pulsação quando online e destaca o nó selecionado. A cor
  que estiver no arquivo não importa.
- Até 256 KB, 5.000 elementos e 32 níveis de aninhamento.

O arquivo é **reconstruído por lista de permissões**, no servidor ao enviar e de
novo no navegador ao desenhar: ficam só formas, grupos, gradientes, máscaras,
recortes, filtros simples e texto, com atributos de geometria e aparência.
São removidos `<script>`, `<foreignObject>`, `<image>`, links, animações,
eventos (`on…`), metadados e atributos de editor (Inkscape/Sodipodi);
`url(...)` e `href` só podem apontar para um `id` do próprio arquivo.
DOCTYPE/ENTITY, CDATA e instruções de processamento recusam o arquivo.
`style="..."` vira atributos; de `<style>`, só regras `.classe { … }` (o
formato do Illustrator) são aplicadas — no Illustrator, prefira exportar com
"Atributos de apresentação". O arquivo é servido com
`Content-Security-Policy: default-src 'none'`, então abrir a URL direto também
não executa nada. A lógica está em `src/core/svg-sanitize.ts`.

Para também oferecer uma foto padrão do novo modelo, salve o arquivo como
`web/src/art/decos/deco-<modelo>.png` (o nome vira a chave normalizada, por
exemplo `deco-x50.png` → `X50`) e gere o build de novo. O arquivo não vai para
o git. Isso não altera as coordenadas do desenho SVG.

## Editor, importação e exportação de temas

**Configurações → Editor de temas** permite ajustar cores, fontes, tamanhos,
raios dos controles/painéis/diálogos/indicadores/ícones, espessura das bordas,
sombras, relevo, gradientes e brilho. A prévia é imediata e temporária:
**Salvar e aplicar** persiste no navegador; **Cancelar prévia** ou sair da tela
restaura o tema selecionado. Temas incluídos são preservados; editar um deles
começa uma cópia com identificador próprio.

**Exportar JSON** baixa um arquivo completo e versionado. **Importar JSON**
valida o formato e aplica o tema; se já existir o identificador, cria uma cópia.
O limite é 64 KB por arquivo e 50 temas personalizados por navegador. Os temas
personalizados sincronizam entre abas e podem ser transferidos por arquivo;
não são enviados ao servidor nem incluídos no backup dos cadastros.
Restaurar preferências locais não apaga os arquivos de temas personalizados.

Os cinco temas incluídos também são arquivos em `web/src/themes/*.json`.
Para adicionar um tema distribuído junto do painel, copie um JSON exportado
para essa pasta, atribua `id` único e `label` e execute o build. O Vite descobre
os arquivos automaticamente: não é necessário criar uma classe CSS ou alterar
um componente para cada tema. Arquivos inválidos aparecem como aviso em
Configurações e são ignorados, preservando os temas válidos.

O formato é `deco-web-theme`, versão `1`:

- `id`, `label`, `description`, `mode`, `order`: identificação e apresentação.
- `colors`: paleta completa de superfícies, textos, navegação, estados,
  gráficos, rede e ilustrações; cores hexadecimais `#RRGGBB` ou `#RRGGBBAA`.
- `geometry`: raios em pixels e espessura das bordas. Zero produz cantos retos.
- `typography`: família de fonte e tamanho base do texto.
- `effects`: gradientes, brilho, relevo clássico e ícones coloridos.
- `shadow`: `none`, `soft` ou `hard`.

O contrato validado está em `src/core/theme-config.ts`. Não são aceitos CSS,
URLs ou fontes externas arbitrárias. É mais simples exportar um tema existente
e ajustar os campos do que escrever o arquivo completo do zero.

O modo TV agora **segue o tema selecionado**, inclusive claro/escuro, medidas e
efeitos. Painéis da TV, avatares e controles usam as mesmas variáveis de
acabamento; círculos funcionais do mapa e indicadores de status continuam
círculos, independentemente do raio dos painéis.

### Par do modo Automático

Ao selecionar **Automático** em **Configurações → Aparência**, escolha **Tema
para modo claro** e **Tema para modo escuro**. Cada lista inclui os temas
correspondentes, inclusive os personalizados. A preferência do sistema define
qual dos dois é aplicado, também no modo TV. As escolhas ficam preservadas ao
usar um tema manual e sincronizam entre abas deste navegador.

As preferências antigas usam Profissional Claro/Escuro. Se um tema escolhido
for removido ou mudar entre claro e escuro, apenas essa faixa volta ao padrão.
O par pertence às preferências do navegador; exportar um tema continua gerando
somente o JSON do tema individual efetivamente aplicado.


## Monitoramento direto de switches

A página **Switches** (`#/switches`) cadastra switches HTTP compatíveis com os templates HORACO/KeepLink/RTLPlayground incluídos. A coleta é feita pelo próprio Deco Dashboard, sem consultar a API nem executar o servidor do Switch Dashboard. O coletor Python adaptado mantém sua licença MIT em `collectors/switches/`.

- Portas: estado, velocidade, duplex, contadores, taxas RX/TX e anotações.
- Histórico de portas em SQLite, com a mesma retenção configurada para o painel. A consulta retorna até 2.000 amostras recentes do período.
- Tabela MAC com porta e VLAN; associação com os nomes já conhecidos no inventário e nós mesh. Uma observação indica alcançabilidade pela porta, não conexão física direta.
- Diagnóstico SFP sob demanda, conforme suporte do equipamento.
- Uplink físico como anotação manual. O mapa mesh continua baseado nas relações reportadas pelo Deco, não é um mapa completo de cabos/switches.

O agendamento é independente do Deco: intervalo por switch entre 30 e 3.600 segundos, sem consultas simultâneas ao mesmo equipamento, com limite de 120 segundos por operação. RX/TX são vistos pelo switch; a primeira leitura não tem taxa. Queda de contador ou reinício detectado interrompe o cálculo de deltas. Os volumes acumulam apenas deltas observados. Valores legados calculados a partir de pacotes são identificados como estimativas. Leituras com falha preservam o último snapshot e são sinalizadas como desatualizadas.

### Dependências e credenciais

Docker e instalador Proxmox incluem Python, BeautifulSoup e PyYAML. Na execução local Debian/Ubuntu:

```bash
sudo apt install python3 python3-bs4 python3-yaml
npm run test:collectors
```

Alternativa: um virtualenv com `pip install -r collectors/switches/requirements.txt` e `SWITCH_PYTHON=/caminho/venv/bin/python` no ambiente do backend.

A senha é enviada ao processo por stdin, nunca por argv ou logs. Fica em `DATA_DIR/switch-secrets/<id>`, com diretório 0700 e arquivo 0600. Não é retornada pela API nem incluída na auditoria. Campo de senha vazio ao editar mantém a existente. Os cadastros e últimas leituras ficam no banco; as amostras usam a tabela `switch_port_samples`.

O backup JSON de cadastros existente **ainda não inclui switches**. Para backup integral, preserve o SQLite e o diretório `switch-secrets` com suas permissões. Remover um switch apaga seu cadastro, credencial e histórico de portas. Operações locais usam a autenticação da interface; esta integração oferece somente leitura nos switches, sem reinício nem alteração de portas. OVS/SSH e FritzBox não foram incorporados.

Ao migrar do Switch Dashboard, evite manter os dois coletores consultando o mesmo switch, pois os firmwares podem aceitar apenas uma sessão administrativa.


## Versão 2.0 — mapa físico e caminho para outros fabricantes

A Visão geral oferece os modos **Físico** e **Mesh**. O modo físico reúne Decos, switches monitorados e switches intermediários cadastrados. **Editar cabeamento** salva equipamentos, uplinks e portas no SQLite (`physical_topology`). Linhas contínuas são ligações cadastradas; tracejadas são relações informadas pelo Deco; pontilhadas são observações MAC, que não provam cabo direto. O modo Mesh mantém o desenho anterior reportado pelo firmware. Clientes são opcionais para preservar a legibilidade.

O cadastro rejeita ciclos, dois uplinks para o mesmo equipamento e referências desconhecidas. Switches intermediários sem gerenciamento têm estado desconhecido, em vez de um falso indicador online. A topologia física também fica fora do backup JSON atual; o backup integral deve preservar o SQLite.

Os coletores de Deco e switches são separados, mas o núcleo ainda tem tipos e operações específicas do Deco. O caminho previsto para novos fabricantes é introduzir um contrato comum de leitura (equipamentos, interfaces, clientes, enlaces, contadores e capacidades), implementar adaptadores por fabricante e manter reserva DHCP/reinício/configuração como capacidades opcionais. Não é necessário reescrever inventário, histórico e mapa para cada fabricante. A versão 2.0 ainda não implementa esse contrato nem declara suporte a outros roteadores.


### Organização visual dos mapas

Nos modos Físico e Mesh, arraste equipamentos com mouse ou toque. Nos dois mapas, mover um pai leva os seus descendentes pelo mesmo deslocamento. No Mesh, os clientes acompanham os Decos; também é possível mover clientes individualmente. Linhas e fluxos acompanham os equipamentos, sem alterar suas ligações ou o cabeamento cadastrado.

As posições ficam no SQLite, separadamente nas chaves `map_layout:physical` e `map_layout:mesh`, compartilhadas entre navegadores e com o modo TV. As gravações são por nó e a atualização chega às outras telas por SSE. Posições locais antigas são importadas uma única vez, quando o servidor ainda não tem um layout inicializado. **Restaurar posições** limpa somente o mapa atual; o menu contextual também permite restaurar um único nó. Restaurar preferências locais não apaga os layouts compartilhados. O backup JSON atual não inclui layouts; o backup integral do SQLite os preserva.


### Portas, painéis, grade e criação de equipamentos

O mapa Físico oferece visuais **Equipamentos** e **Cartões**. O primeiro reutiliza a arte configurada dos Decos e usa painéis frontais vetoriais para os switches, com portas e LEDs conforme os dados disponíveis. O desenho de switch é uma representação genérica, não uma fotografia exata do modelo; o template KeepLink KP-9000-9XHML-X distingue a porta SFP+ 9. Estados das portas vêm da coleta; equipamentos manuais mantêm estado desconhecido.

Referências usadas: [Deco X50 — 3 portas](https://static.tp-link.com/upload/product-overview/2024/202402/20240226/Deco%20X50%28US%291.30_Datasheet.pdf), [Deco M4 — 2 portas](https://www.tp-link.com/us/deco-mesh-wifi/product-family/deco-m4/), [Deco M5 — 2 portas](https://www.omadanetworks.com/us/deco-mesh-wifi/product-family/deco-m5/), [exemplo de painel KeepLink](https://manuals.plus/asin/B0D49BFN7H). A contagem de portas é configurável; variantes não reconhecidas não herdam automaticamente a contagem de outro modelo.

O botão direito abre o menu para adicionar nó de rede, switch ou dispositivo manual, configurar portas e cadastrar um switch monitorado. O menu também funciona com o comando de menu contextual do teclado. Equipamentos criados pelo Mesh aparecem no Físico; desenhar um nó não provisiona um Deco real. O cadastro físico fica no SQLite.

**Encaixar na grade** move nós em passos de 20 unidades e pode ser desligado. A grade e o visual são preferências locais; posições continuam compartilhadas no banco. No mapa Físico, clique na porta de origem e depois na porta de destino para cadastrar o cabo. Os extremos do enlace usam os mesmos pontos geométricos das portas desenhadas. Portas não informadas usam um marcador `?`; não se escolhe uma porta arbitrária.

O modo TV oferece **Físico / Mesh**, reaproveita as mesmas posições do banco e não apresenta controles de edição. Descoberta automática por LLDP ainda não está implementada: o cadastro manual e as observações MAC continuam sendo fontes distintas.


### Navegação, edição por nó e interfaces

A roda do mouse aproxima/afasta o mapa sob o cursor, sem alterar o zoom da página. Arrastar o fundo faz pan; botão do meio ou Espaço + arraste também permitem navegar. Os controles de zoom e **Ajustar à tela** estão disponíveis nos dois mapas, inclusive em telas estreitas. A câmera permanece estável durante o movimento dos equipamentos; **Ajustar à tela** recalcula o enquadramento.

Ao mover um pai, os descendentes mantêm seu deslocamento relativo. A gravação do grupo é uma única atualização no SQLite. O modo TV reaproveita essas posições, com enquadramento próprio e sem edição.

O menu de cada nó oferece **Editar cabeamento** e mostra apenas os cabos incidentes nele. Cada cabo possui duas pontas e é cadastrado uma única vez; a ligação aparece automaticamente na consulta dos dois equipamentos. Os números/nomes das portas não são adivinhados quando a coleta não os fornece. **Configurar portas** aceita nomes como `eth0`, `eth1` e `LAN 1`; ao renomear, os cabos ligados às portas acompanham a mudança. Dispositivos com múltiplas interfaces podem ter vários cabos, desde que cada porta física seja usada uma única vez.

Os conectores foram ampliados e receberam identificação visível e área de clique maior. O roteador de cabos usa corredores ortogonais para desviar dos retângulos dos equipamentos, mantendo os extremos nas portas. Equipamentos sobrepostos podem impedir uma rota totalmente livre; mova-os para abrir espaço. Nomes de portas também são preservados no SQLite (`physical_topology.portNames`).


### Interface e topologia integradas

Os componentes comuns usam shadcn/Radix com Preact/compat e os tokens dos temas existentes. O build rejeita a inclusão acidental dos runtimes React/React DOM.

O mapa completo fica em **Infraestrutura → Topologia** (primeira aba). A **Visão geral** mostra o mesmo mapa salvo em modo de consulta, com zoom, navegação e opção **Mostrar clientes**; o botão **Abrir topologia para editar** leva ao editor. O mapa **Físico** usa JointJS + libavoid para desviar os cabos dos equipamentos e separar as linhas; **Organizar rede** usa ELK e salva as posições pela API existente. Arraste entre portas livres para cadastrar uma ligação, clique na linha para consultar sua origem ou remover uma ligação cadastrada. Conexões observadas/mesh não são apagadas nem convertidas automaticamente em cabeamento físico.

**Equipamentos** usa PNGs genéricos transparentes em vista traseira, com as âncoras nas posições dos conectores. **Cartões** usa blocos genéricos. O ponto Wi-Fi permanece no topo central, separado das portas numeradas. Nomes de portas personalizados são preservados; portas desconhecidas aparecem como `?`, sem inferir uma porta física.

Selecione o equipamento e use **PNG e portas…** para gerar outro formato, importar um PNG e calibrar seus conectores. A imagem PNG e a calibração ficam no SQLite, compartilhadas entre navegadores. O cadastro de portas, cabeamento e posições também fica no servidor. Calibrações locais antigas são importadas automaticamente sem sobrescrever registros já compartilhados. Trocar a imagem exige recalibrar todas as portas. O mapa carrega seu motor sob demanda; o WASM e suas licenças são distribuídos separadamente no frontend.

**Ver em tela cheia** expande o mesmo mapa, preservando zoom, posições e cabeamento; **Sair da tela cheia** ou `Esc` restaura a visualização. Quando a API nativa não está disponível, a expansão ocupa a janela. As posições recuperadas do banco sempre prevalecem sobre a distribuição automática ao carregar o mapa.
