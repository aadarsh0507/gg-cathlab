#!/bin/sh
# One-time (or per-boot, via /etc/fstab or a systemd unit) CIFS mount for the
# vendor-documents NAS share, run on the Docker HOST — not inside the container.
# Reads NAS_HOST/NAS_SHARE/NAS_USERNAME/NAS_PASSWORD from an env file so nothing
# is typed on the command line. The app itself never mounts anything; it just
# reads/writes files under NAS_SHARE_PATH once this mount exists.
#
# Usage:
#   sudo ./mount-nas.sh ~/env/implants.env /mnt/vendor-documents
#
# Then point NAS_SHARE_PATH in implants.env at the same local mount point
# (e.g. NAS_SHARE_PATH=/mnt/vendor-documents) and pass
#   -v /mnt/vendor-documents:/mnt/vendor-documents
# to `docker run` so the container sees the same path.

set -eu

ENV_FILE="${1:?Usage: $0 <env-file> <mount-point> [//nas-host/share]}"
MOUNT_POINT="${2:?Usage: $0 <env-file> <mount-point> [//nas-host/share]}"
SHARE_UNC="${3:-}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi

# Pull NAS_USERNAME / NAS_PASSWORD / legacy NAS_SHARE_PATH out of the env file
# without sourcing it (avoids executing arbitrary content in the file).
NAS_USERNAME=$(grep -E '^NAS_USERNAME=' "$ENV_FILE" | tail -1 | cut -d '=' -f2-)
NAS_PASSWORD=$(grep -E '^NAS_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d '=' -f2-)
LEGACY_UNC=$(grep -E '^NAS_SHARE_PATH=' "$ENV_FILE" | tail -1 | cut -d '=' -f2-)

if [ -z "$SHARE_UNC" ]; then
  # Convert a legacy Windows UNC path (\\host\share\folder) from the env file
  # into the //host/share/folder form `mount -t cifs` expects.
  SHARE_UNC=$(printf '%s' "$LEGACY_UNC" | sed 's/\\\\/\//g; s/\\/\//g')
fi

if [ -z "$NAS_USERNAME" ] || [ -z "$NAS_PASSWORD" ] || [ -z "$SHARE_UNC" ]; then
  echo "ERROR: could not read NAS_USERNAME, NAS_PASSWORD, and a share path from $ENV_FILE (or arg 3)." >&2
  exit 1
fi

command -v mount.cifs >/dev/null 2>&1 || {
  echo "ERROR: cifs-utils not installed. Install it first: sudo apt-get install -y cifs-utils" >&2
  exit 1
}

mkdir -p "$MOUNT_POINT"

if mountpoint -q "$MOUNT_POINT"; then
  echo "Already mounted at $MOUNT_POINT, nothing to do."
  exit 0
fi

CRED_FILE=$(mktemp)
chmod 600 "$CRED_FILE"
trap 'rm -f "$CRED_FILE"' EXIT

printf 'username=%s\npassword=%s\n' "$NAS_USERNAME" "$NAS_PASSWORD" > "$CRED_FILE"

mount -t cifs "$SHARE_UNC" "$MOUNT_POINT" \
  -o "credentials=$CRED_FILE,uid=$(id -u),gid=$(id -g),iocharset=utf8,file_mode=0664,dir_mode=0775"

echo "Mounted $SHARE_UNC at $MOUNT_POINT"
