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
| Visão geral | Nós (modelo, firmware, backhaul, sinal do uplink, online desde), internet/WAN, Wi-Fi, CPU/memória, totais por banda |
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
chmod 600 secrets/*
# Ajuste DECO_HOST e o resto em compose.yaml, depois:
docker compose up -d --build
```

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
| `DECO_ALLOW_DANGEROUS` | `0` | Reservado para reboot/Wi-Fi (não implementados). Exige `DECO_ALLOW_WRITE=1` |
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

## Próximos passos (preparado, não implementado)

- **NAS Synology.** Rode o container no próprio NAS (Container Manager) com o
  volume `/data` **em disco local**. Não ponha o SQLite em NFS/SMB: o modo WAL
  depende de travas que compartilhamentos de rede não garantem. Para guardar
  cópias no NAS, exporte o backup JSON (ou `.backup` do SQLite) para uma pasta
  montada por NFS.
- **Prometheus.** Um `GET /metrics` sairia direto do cache do poller (nós
  online, clientes por banda/nó, internet, CPU/memória, estado do breaker,
  idade do snapshot) sem nenhuma chamada extra ao Deco.
- **OIDC / SSO.** O caminho previsto é um proxy na frente (oauth2-proxy,
  Authelia, Authentik) e um modo que confie no usuário enviado por ele em vez
  de `UI_PASSWORD`; a auditoria já tem o campo "quem" para registrar o nome.

## Licença

MIT. Inclui código do [deco-mcp](https://github.com/fullo/deco-mcp)
(MIT, © Francesco Fullone) — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
