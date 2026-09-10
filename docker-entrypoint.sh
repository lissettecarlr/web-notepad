#!/bin/sh
set -e

# 容器以 root 启动，把挂载进来的 notes 目录所有权修正后再降权运行。
# 用户无需关心宿主机目录权限；如需与宿主机用户对齐可传 PUID/PGID。
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
NOTES_DIR="${NOTES_DIR:-/app/notes}"

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$NOTES_DIR"
    if [ "$(stat -c %u "$NOTES_DIR")" != "$PUID" ] || [ "$(stat -c %g "$NOTES_DIR")" != "$PGID" ]; then
        chown -R "$PUID:$PGID" "$NOTES_DIR" 2>/dev/null || true
    fi
    exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi

exec "$@"
