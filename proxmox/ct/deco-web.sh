#!/usr/bin/env bash
# Os scripts do deco-web (ct/ e install/) vêm deste repositório; o motor
# (build.func: menus, criação do CT, motd, comando "update") vem do
# community-scripts/core, como nos scripts oficiais.
: "${COMMUNITY_SCRIPTS_URL:=https://raw.githubusercontent.com/fcrespo82/deco-web/main/proxmox}"
export COMMUNITY_SCRIPTS_URL
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2026 Fernando Crespo
# Author: Fernando Crespo (fcrespo82)
# License: MIT | https://github.com/fcrespo82/deco-web/raw/main/LICENSE
# Source: https://github.com/fcrespo82/deco-web

APP="Deco-Web"
var_tags="${var_tags:-network;monitoring}"
var_cpu="${var_cpu:-1}"
var_ram="${var_ram:-512}"
var_disk="${var_disk:-4}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-yes}"
var_unprivileged="${var_unprivileged:-1}"

# O cabeçalho em ASCII dos oficiais vem do repositório deles; este não está lá.
_CS_FALLBACK_HEADER="$(
  cat <<'EOF'
    ____                                    __
   / __ \___  _________        _      _____/ /_
  / / / / _ \/ ___/ __ \______| | /| / / _ \ __ \
 / /_/ /  __/ /__/ /_/ /_____/| |/ |/ /  __/ /_/ /
/_____/\___/\___/\____/       |__/|__/\___/_.___/
EOF
)"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -d /opt/deco-web ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  NODE_VERSION="22" setup_nodejs

  if check_for_gh_release "deco-web" "fcrespo82/deco-web"; then
    msg_info "Stopping Service"
    # O serviço espera o poll em andamento deslogar do Deco (até 60 s).
    systemctl stop deco-web
    msg_ok "Stopped Service"

    msg_info "Backing up Data"
    local old_version stamp backup_dir="/var/lib/deco-web/backups"
    old_version="$(cat ~/.deco-web 2>/dev/null || echo unknown)"
    stamp="${old_version}-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    if [[ -f /var/lib/deco-web/deco-web.sqlite ]]; then
      sqlite3 /var/lib/deco-web/deco-web.sqlite ".backup '${backup_dir}/deco-web-${stamp}.sqlite'"
    fi
    # Mantém os 5 backups mais recentes.
    find "$backup_dir" -maxdepth 1 -name 'deco-web-*.sqlite' -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2- | xargs -r rm -f
    rm -rf /opt/deco-web.bak
    cp -a /opt/deco-web /opt/deco-web.bak
    chown -R deco-web:deco-web "$backup_dir"
    msg_ok "Backed up Data"

    CLEAN_INSTALL=1 fetch_and_deploy_gh_release "deco-web" "fcrespo82/deco-web" "prebuild" "latest" "/opt/deco-web" "deco-web-*.tar.gz"

    msg_info "Updating ${APP}"
    cd /opt/deco-web || exit
    if ! $STD npm ci --omit=dev; then
      # Sem binário pronto do better-sqlite3 para esta plataforma: compila.
      $STD apt install -y python3 make g++
      $STD npm ci --omit=dev
    fi
    msg_ok "Updated ${APP}"

    msg_info "Starting Service"
    systemctl start deco-web
    local ok=""
    for _ in $(seq 1 30); do
      if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
        ok=1
        break
      fi
      sleep 1
    done
    if [[ -z "$ok" ]]; then
      msg_error "${APP} did not come up after the update - restoring the previous version"
      systemctl stop deco-web
      rm -rf /opt/deco-web
      mv /opt/deco-web.bak /opt/deco-web
      echo "$old_version" >~/.deco-web
      systemctl start deco-web
      echo -e "Logs: journalctl -u deco-web -n 100 --no-pager"
      echo -e "Database backup: ${backup_dir}/deco-web-${stamp}.sqlite"
      exit 1
    fi
    rm -rf /opt/deco-web.bak
    msg_ok "Started Service"
    msg_ok "Updated successfully!"
  fi
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Access it using the following URL:${CL}"
echo -e "${GATEWAY}${BGN}http://${IP}:8080${CL}"
echo -e "${INFO}${YW}Config: /etc/deco-web/deco-web.env (then: systemctl restart deco-web)${CL}"
