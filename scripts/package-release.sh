#!/usr/bin/env bash
# Gera o pacote de release (o que o CT do Proxmox baixa e instala):
#   deco-web-<versão>.tar.gz  — build pronto, sem node_modules
#   deco-web-<versão>.tar.gz.sha256
#
# Uso: scripts/package-release.sh [versão]   (padrão: version do package.json)
# O CT roda "npm ci --omit=dev" no pacote, que baixa o better-sqlite3 já
# compilado para a plataforma dele.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="${1:-$(node -p 'require("./package.json").version')}"
VERSION="${VERSION#v}"
OUT="release"
NAME="deco-web-${VERSION}"

rm -rf dist web/dist
npm run build >/dev/null

rm -rf "${OUT:?}/${NAME}"
mkdir -p "${OUT}/${NAME}"
cp -r dist "${OUT}/${NAME}/dist"
mkdir -p "${OUT}/${NAME}/web"
cp -r web/dist "${OUT}/${NAME}/web/dist"
cp -r fixtures oui proxmox "${OUT}/${NAME}/"
cp package.json package-lock.json README.md LICENSE THIRD_PARTY_NOTICES.md "${OUT}/${NAME}/"
echo "${VERSION}" > "${OUT}/${NAME}/VERSION"

# Arquivo reprodutível: ordem e datas fixas, sem dono.
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@${SOURCE_DATE_EPOCH:-0}" \
  -C "${OUT}" -czf "${OUT}/${NAME}.tar.gz" "${NAME}"
rm -rf "${OUT:?}/${NAME}"
(cd "${OUT}" && sha256sum "${NAME}.tar.gz" > "${NAME}.tar.gz.sha256")

echo "${OUT}/${NAME}.tar.gz"
