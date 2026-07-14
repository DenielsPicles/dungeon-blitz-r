#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly PM2_PROCESS_NAME="dungeon-blitz-multiplayer"

if [[ "${EUID}" -eq 0 ]]; then
    echo "Run this setup as the normal Google Cloud VM user, not with sudo." >&2
    exit 1
fi

for command_name in git node npm sudo; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
        echo "Required command not found: ${command_name}" >&2
        exit 1
    fi
done

if ! command -v pm2 >/dev/null 2>&1; then
    echo "[PM2Setup] Installing PM2 globally."
    if ! npm install --global pm2; then
        echo "[PM2Setup] Global npm directory needs elevation; retrying with sudo."
        sudo env "PATH=${PATH}" npm install --global pm2
    fi
    hash -r
fi

readonly PM2_BIN="$(command -v pm2)"

echo "[PM2Setup] Installing the systemd startup service for ${USER}."
sudo env "PATH=${PATH}" "${PM2_BIN}" startup systemd -u "${USER}" --hp "${HOME}"

cd "${REPOSITORY_ROOT}"
echo "[PM2Setup] Starting or reloading ${PM2_PROCESS_NAME}."
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save
pm2 status "${PM2_PROCESS_NAME}"

echo "[PM2Setup] Setup complete. View logs with: pm2 logs ${PM2_PROCESS_NAME}"
