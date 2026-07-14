#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly SERVER_ROOT="${REPOSITORY_ROOT}/src/server"
readonly DEPLOY_BRANCH="${DUNGEON_BLITZ_BRANCH:-multiplayer}"
readonly STASH_MESSAGE="pm2-autoupdate-${DEPLOY_BRANCH}-$(date +%Y%m%d%H%M%S)"

stash_created=false

restore_local_changes() {
    if [[ "${stash_created}" != true ]]; then
        return 0
    fi

    echo "[PM2Deploy] Restoring local runtime changes."
    if ! git stash pop --index; then
        echo "[PM2Deploy] Could not restore local changes cleanly. The stash was kept as ${STASH_MESSAGE}." >&2
        echo "[PM2Deploy] Resolve the Git conflict before restarting the PM2 process." >&2
        return 1
    fi

    stash_created=false
}

restore_on_exit() {
    local exit_code="$1"
    trap - EXIT

    if ! restore_local_changes; then
        exit_code=1
    fi

    exit "${exit_code}"
}

trap 'restore_on_exit $?' EXIT

cd "${REPOSITORY_ROOT}"

if [[ "$(git branch --show-current)" != "${DEPLOY_BRANCH}" ]]; then
    echo "[PM2Deploy] Expected branch ${DEPLOY_BRANCH}; switch to it before starting PM2." >&2
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    echo "[PM2Deploy] Preserving tracked and untracked local changes before updating."
    git stash push --include-untracked --message "${STASH_MESSAGE}"
    stash_created=true
fi

echo "[PM2Deploy] Fetching origin/${DEPLOY_BRANCH}."
git fetch --prune origin "${DEPLOY_BRANCH}"
git merge --ff-only "origin/${DEPLOY_BRANCH}"

restore_local_changes
trap - EXIT

readonly PACKAGE_LOCK_HASH="$(sha256sum "${SERVER_ROOT}/package-lock.json" | awk '{print $1}')"
readonly PACKAGE_LOCK_STAMP="${SERVER_ROOT}/node_modules/.pm2-package-lock.sha256"

if [[ ! -d "${SERVER_ROOT}/node_modules" ]] ||
    [[ ! -f "${PACKAGE_LOCK_STAMP}" ]] ||
    [[ "$(cat "${PACKAGE_LOCK_STAMP}" 2>/dev/null || true)" != "${PACKAGE_LOCK_HASH}" ]]; then
    echo "[PM2Deploy] Installing server dependencies."
    npm ci --include=dev --prefix "${SERVER_ROOT}"
    printf '%s\n' "${PACKAGE_LOCK_HASH}" > "${PACKAGE_LOCK_STAMP}"
else
    echo "[PM2Deploy] Server dependencies already match package-lock.json."
fi

echo "[PM2Deploy] Starting Dungeon Blitz multiplayer from $(git rev-parse --short HEAD)."
cd "${SERVER_ROOT}"
exec node --env-file-if-exists=.env tools/startMultiplayerServer.js
