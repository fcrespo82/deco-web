#!/usr/bin/env bash

# Copyright (c) 2026 Fernando Crespo
# Author: Fernando Crespo (fcrespo82)
# License: MIT | https://github.com/fcrespo82/deco-web/raw/main/LICENSE
# Source: https://github.com/fcrespo82/deco-web

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing dependencies"
$STD apt install -y sqlite3 openssl
msg_ok "Installed dependencies"

NODE_VERSION="22" setup_nodejs

# DECO_WEB_TARBALL (caminho local) serve para testar um pacote ainda não
# publicado; sem ele, baixa o release mais recente do GitHub.
if [[ -n "${DECO_WEB_TARBALL:-}" ]]; then
  msg_info "Deploying local package"
  mkdir -p /opt/deco-web
  tar -xzf "$DECO_WEB_TARBALL" -C /opt/deco-web --strip-components=1
  cat /opt/deco-web/VERSION >~/.deco-web
  msg_ok "Deployed local package ($(cat ~/.deco-web))"
else
  fetch_and_deploy_gh_release "deco-web" "fcrespo82/deco-web" "prebuild" "latest" "/opt/deco-web" "deco-web-*.tar.gz"
fi

msg_info "Installing Deco-Web"
cd /opt/deco-web || exit
if ! $STD npm ci --omit=dev; then
  # Sem binário pronto do better-sqlite3 para esta plataforma: compila.
  $STD apt install -y python3 make g++
  $STD npm ci --omit=dev
fi
useradd --system --home-dir /var/lib/deco-web --shell /usr/sbin/nologin deco-web 2>/dev/null || true
install -d -o deco-web -g deco-web -m 750 /var/lib/deco-web
install -d -o root -g deco-web -m 750 /etc/deco-web
msg_ok "Installed Deco-Web"

# --- configuração ------------------------------------------------------------
# Pergunta o essencial; o resto fica comentado em /etc/deco-web/deco-web.env.
GATEWAY_IP="$(ip route 2>/dev/null | awk '/^default/ {print $3; exit}')"
DECO_HOST="${DECO_HOST:-}"
DECO_PASSWORD="${DECO_PASSWORD:-}"
UI_PASSWORD="${UI_PASSWORD:-}"
if [[ -t 0 || -r /dev/tty ]] && [[ -z "${DECO_PASSWORD}" ]]; then
  echo
  read -r -p "${TAB3}IP do Deco gateway [${GATEWAY_IP:-192.168.68.1}]: " DECO_HOST </dev/tty || true
  read -r -s -p "${TAB3}Senha de administrador do Deco (a mesma do app): " DECO_PASSWORD </dev/tty || true
  echo
  read -r -s -p "${TAB3}Senha para a interface web (vazio = gerar uma): " UI_PASSWORD </dev/tty || true
  echo
fi
DECO_HOST="${DECO_HOST:-${GATEWAY_IP:-192.168.68.1}}"
UI_GENERATED=""
if [[ -z "${UI_PASSWORD}" ]]; then
  UI_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  UI_GENERATED=1
fi

msg_info "Writing Configuration"
umask 027
printf '%s\n' "$DECO_PASSWORD" >/etc/deco-web/deco_password
printf '%s\n' "$UI_PASSWORD" >/etc/deco-web/ui_password
cat <<EOF >/etc/deco-web/deco-web.env
# Configuração do Deco-Web. Depois de editar: systemctl restart deco-web
# Todas as opções estão no README: https://github.com/fcrespo82/deco-web#variáveis-de-ambiente
DECO_HOST=${DECO_HOST}
DECO_PASSWORD_FILE=/etc/deco-web/deco_password
UI_PASSWORD_FILE=/etc/deco-web/ui_password
POLL_INTERVAL=90
TZ=$(cat /etc/timezone 2>/dev/null || echo UTC)

# Escrita no Deco (reservas de IP) e operações perigosas (reiniciar, Wi-Fi):
# DECO_ALLOW_WRITE=1
# DECO_ALLOW_DANGEROUS=1

# Link das notificações para abrir o painel:
# PUBLIC_URL=http://endereço-deste-ct:8080

# Alertas:
# NOTIFY_NTFY_URL=https://ntfy.sh/um-topico-dificil-de-adivinhar
# NOTIFY_TELEGRAM_CHAT_ID=123456789
# NOTIFY_TELEGRAM_TOKEN_FILE=/etc/deco-web/telegram_token
EOF
chown root:deco-web /etc/deco-web/deco-web.env /etc/deco-web/deco_password /etc/deco-web/ui_password
chmod 640 /etc/deco-web/deco-web.env /etc/deco-web/deco_password /etc/deco-web/ui_password
umask 022
msg_ok "Wrote Configuration"

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/deco-web.service
[Unit]
Description=Deco-Web (painel do TP-Link Deco)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=deco-web
Group=deco-web
WorkingDirectory=/opt/deco-web
Environment=NODE_ENV=production
Environment=DATA_DIR=/var/lib/deco-web
Environment=PORT=8080
EnvironmentFile=/etc/deco-web/deco-web.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
# Ao parar, o painel espera o poll em andamento deslogar do Deco (até 60 s).
KillSignal=SIGTERM
TimeoutStopSec=75
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
if [[ -n "$DECO_PASSWORD" ]]; then
  systemctl enable -q --now deco-web
else
  # Sem a senha do Deco o serviço só ficaria reiniciando: deixa habilitado e parado.
  systemctl enable -q deco-web
fi
msg_ok "Created Service"

if [[ -z "$DECO_PASSWORD" ]]; then
  msg_warn "Senha do Deco não informada: edite /etc/deco-web/deco_password e rode systemctl start deco-web"
fi
if [[ -n "$UI_GENERATED" ]]; then
  echo -e "${INFO}${YW} Senha da interface (gerada, também em /etc/deco-web/ui_password): ${BGN}${UI_PASSWORD}${CL}"
fi

motd_ssh
customize
cleanup_lxc
