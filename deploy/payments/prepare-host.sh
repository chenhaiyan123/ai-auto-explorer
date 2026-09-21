#!/usr/bin/env bash
# Run on the new Ubuntu server only, after checking its identity and open ports.
# Official installation reference: https://docs.docker.com/engine/install/ubuntu/
set -euo pipefail
[[ "$(uname -s)" == Linux && "$EUID" -eq 0 ]] || { echo 'Run as root on the target Linux server.' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'This bootstrap is for Ubuntu 24.04 only.' >&2; exit 1; }

# Preserve an existing container installation. Never uninstall packages or replace
# another application's listener as part of provisioning this service.
if command -v docker >/dev/null; then
  docker info >/dev/null
  docker compose version
else
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q '^install ok installed$'; then
      printf 'Existing package %s requires operator review. No packages removed.\n' "$package" >&2
      exit 1
    fi
  done
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl
  install -d -m 0755 /etc/apt/keyrings
  curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' \
    https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod 0644 /etc/apt/keyrings/docker.asc
  [[ ! -e /etc/apt/sources.list.d/docker.sources ]] || { echo 'Docker apt source already exists; review it first.' >&2; exit 1; }
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  docker info >/dev/null
  docker compose version
fi

install -d -m 0755 /srv/hiexplore /srv/hiexplore/app
install -d -m 0700 -o 1000 -g 1000 /srv/hiexplore/secrets /srv/hiexplore/wechat-platform
install -d -m 0700 /srv/hiexplore/backups
echo 'Host prepared. Upload the runtime and server-only credentials before starting Compose.'
