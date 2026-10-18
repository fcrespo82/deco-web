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
| Clientes | Online e offline já vistos, filtros, IP, nó, banda, taxa atual, primeira/última vez; "Fixar IP" |
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

## Como ele fala com o Deco

O Deco aceita **uma única sessão de administrador por vez**: enquanto o painel
está logado, o app do celular é desconectado (e vice-versa). Por isso:

- **Sessões curtas.** Cada leitura é login → leituras → logout, sempre. Nenhuma
  sessão fica aberta. Num X50 medimos ~13 s por leitura (login 6–17 s).
- **A interface nunca fala com o Deco.** Ela lê o cache do último poll; o botão
  "Atualizar" pede um poll e tem intervalo mínimo de 30 s.
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

O endpoint de reinício vem do deco-mcp.

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
- `npm run probe` lista, só com leituras, o que o seu Deco responde; grava
  `probe-output.json` (contém dados da sua rede; está no `.gitignore`).

## Proxmox (com cópias no Synology)

O painel é leve (poucas dezenas de MB de RAM, CPU quase parada) e cabe num **container LXC**
pequeno:

1. Crie um LXC Debian 12 **sem privilégios**, com 1 vCPU, 512 MB de RAM e 4 GB
   de disco **local** (`local-lvm` ou ZFS do próprio Proxmox). Em *Options →
   Features*, ligue `nesting` (e `keyctl`, se usar Docker).
2. Dentro dele, instale Podman (`apt install podman podman-compose`) ou Docker
   e siga a [Instalação](#instalação-docker--podman).
3. Use IP fixo na LAN, por reserva de DHCP (dá para fazer pelo próprio painel)
   ou na configuração de rede do LXC, e ligue a porta a esse IP no
   `compose.override.yaml`.

**Onde ficam os dados.** O volume `/data` (SQLite) fica no disco local do LXC,
**nunca em NFS/SMB**: o modo WAL do SQLite depende de travas que
compartilhamentos de rede não garantem, e o banco pode corromper. O Synology
guarda as **cópias**:

- *Backup do LXC inteiro:* em *Datacenter → Storage*, adicione um storage NFS
  apontando para uma pasta do Synology (conteúdo "VZDump backup") e agende um
  backup diário do LXC no modo *snapshot*. Isso leva o banco, os segredos e a
  configuração.
- *Só os dados do painel:* monte uma pasta NFS do Synology no LXC e agende
  `sqlite3 /caminho/do/volume/deco-web.sqlite ".backup /mnt/synology/deco-web-$(date +%F).sqlite"`,
  ou baixe o JSON da tela Backup.

Uma VM também funciona, mas gasta mais memória para o mesmo resultado.

## Próximos passos (preparado, não implementado)

- **OIDC / SSO.** O caminho previsto é um proxy na frente (oauth2-proxy,
  Authelia, Authentik) e um modo que confie no usuário enviado por ele em vez
  de `UI_PASSWORD`; a auditoria já tem o campo "quem" para registrar o nome.

## Licença

MIT. Inclui código do [deco-mcp](https://github.com/fullo/deco-mcp)
(MIT, © Francesco Fullone) — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
