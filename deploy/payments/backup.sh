#!/usr/bin/env bash
# Consistent encrypted-ledger backup. Does not include WAKE_MASTER_KEY or merchant keys.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
destination="${1:?Usage: bash deploy/payments/backup.sh /absolute/backup/directory}"
[[ "$destination" == /* ]] || { echo 'Backup directory must be absolute' >&2; exit 1; }
mkdir -p "$destination"
command -v flock >/dev/null || { echo 'Install util-linux (flock) before backing up' >&2; exit 1; }
exec 9>"$destination/.hiexplore-backup.lock"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
compose=(docker compose --env-file .env.payments.local -f compose.payments.yml)
[[ -n "$("${compose[@]}" ps -a -q backend)" ]] || { echo 'No deployed backend found; refusing to back up an empty volume' >&2; exit 1; }
was_running="$("${compose[@]}" ps --status running -q backend)"
staging=''
resume() {
  if [[ -n "$staging" && -d "$staging" ]]; then rm -rf -- "$staging"; fi
  if [[ -n "$was_running" ]]; then "${compose[@]}" start backend >/dev/null; fi
}
trap resume EXIT
"${compose[@]}" stop -t 300 backend >/dev/null
filename="ledger-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
[[ ! -e "$destination/$filename" ]] || { echo 'Backup filename already exists' >&2; exit 1; }
staging="$(mktemp -d "$destination/.backup-stage.XXXXXX")"
# Read the ledger as its owner: this container drops all capabilities, so UID 0
# cannot read UID 1000's private files. Only the staging directory changes owner.
chown 1000:1000 "$staging"
"${compose[@]}" run --rm --no-deps --user 1000:1000 --entrypoint sh -v "$staging:/backup" backend \
  -ec 'umask 077; tar -czf "/backup/$1" -C /data .; tar -tzf "/backup/$1" >/dev/null' sh "$filename"
mv "$staging/$filename" "$destination/$filename"
chown "$(id -u):$(id -g)" "$destination/$filename"
chmod 600 "$destination/$filename"
printf 'Backup verified: %s\n' "$destination/$filename"
printf 'Back up the encryption master key separately; this archive alone cannot restore access.\n'
