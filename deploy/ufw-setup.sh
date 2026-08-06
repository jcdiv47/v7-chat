#!/usr/bin/env bash
#
# Configure host-side firewalling for the single-host deployment, without
# touching the cloud security group.
#
#   sudo ./deploy/ufw-setup.sh                               # SSH open to all (default)
#   sudo ./deploy/ufw-setup.sh --ssh-from 203.0.113.7        # optional restriction
#   ./deploy/ufw-setup.sh --dry-run                          # print, change nothing
#
# Two independent layers, because they protect different traffic:
#
#   ufw          filters traffic terminating on the *host* — sshd, and anything
#                else that ever starts listening there. It does not see traffic
#                forwarded to containers.
#
#   DOCKER-USER  filters traffic *forwarded to containers*. Docker's own rules
#                are inserted ahead of ufw's, so this chain — which Docker
#                guarantees to consult first, and never overwrites — is the only
#                supported place to constrain a published port.
#
# The DOCKER-USER policy installed here is default-deny with 80/443 allowed.
# For the production stack that changes nothing today: Caddy publishes exactly
# 80/443 and both databases are on an internal network with no host port. Its
# value is future accidents — a debug port published on a whim, or
# docker-compose.local.yml started on the server — which would otherwise be
# reachable from the internet the moment they start.
set -euo pipefail

ssh_from=any
dry_run=false

while [ $# -gt 0 ]; do
  case "$1" in
    --ssh-from) ssh_from=${2:?--ssh-from needs an IP or CIDR}; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --help | -h) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ "$dry_run" = false ] && [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

# Traffic from outside arrives on the default-route interface. Container-to-
# container and outbound traffic does not, which is how the rules below can
# default-deny inbound without cutting the app off from Clerk or OpenRouter.
ext_if=${EXT_IF:-$(ip route show default 2>/dev/null | awk '{print $5; exit}')}
if [ -z "${ext_if:-}" ]; then
  echo "Could not determine the external interface; set EXT_IF=<name>." >&2
  [ "$dry_run" = false ] && exit 1
  ext_if='<external-interface>'
fi

# NOTE: DOCKER-USER is traversed *after* Docker's DNAT, so the destination port
# here is the CONTAINER port, not the published host port. They are equal for
# Caddy (80:80, 443:443); a remapped publish such as "8080:3000" would need
# --dport 3000. Matching on the host port silently matches nothing.
read -r -d '' docker_rules <<EOF || true
# BEGIN v7-chat managed block — regenerate with deploy/ufw-setup.sh
#
# Filters traffic forwarded to containers. ufw does not police this; Docker's
# published-port rules bypass ufw's chains entirely.
*filter
:DOCKER-USER - [0:0]

# Replies to connections the containers opened themselves (OpenRouter, Clerk,
# Langfuse, image pulls). Must come first, or egress breaks.
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN

# The public application, served by Caddy.
-A DOCKER-USER -i $ext_if -p tcp --dport 80 -j RETURN
-A DOCKER-USER -i $ext_if -p tcp --dport 443 -j RETURN
-A DOCKER-USER -i $ext_if -p udp --dport 443 -j RETURN

# Anything else arriving from outside for a container: refuse. This is what
# makes an accidental publish harmless.
-A DOCKER-USER -i $ext_if -j DROP

# Traffic that did not arrive from outside — between containers, or from the
# host — is left to Docker's own rules.
-A DOCKER-USER -j RETURN
COMMIT
# END v7-chat managed block
EOF

if [ "$dry_run" = true ]; then
  echo "External interface: $ext_if"
  echo "SSH allowed from:   $ssh_from"
  echo
  echo "--- appended to /etc/ufw/after.rules ---"
  echo "$docker_rules"
  exit 0
fi

command -v ufw >/dev/null || { echo "ufw is not installed (apt install ufw)." >&2; exit 1; }

echo "==> Host policy (ufw)"
ufw --force default deny incoming
ufw --force default allow outgoing

# SSH first, and before enabling: locking yourself out of a remote host is the
# one mistake here that cannot be undone over SSH.
if [ "$ssh_from" = any ]; then
  echo "    allowing SSH from any address (default)"
  ufw allow 22/tcp
else
  ufw allow from "$ssh_from" to any port 22 proto tcp
fi

# Declared for documentation and for any future host-terminated listener. It is
# NOT what admits traffic to Caddy — Docker already does that.
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp

echo "==> Container policy (DOCKER-USER via /etc/ufw/after.rules)"
after_rules=/etc/ufw/after.rules
cp "$after_rules" "$after_rules.bak.$(date -u +%Y%m%dT%H%M%SZ)"

# Rewrite rather than append, so re-running does not stack duplicate blocks.
python3 - "$after_rules" <<PY
import re, sys
path = sys.argv[1]
block = """$docker_rules"""
text = open(path).read()
pattern = re.compile(
    r"\n?# BEGIN v7-chat managed block.*?# END v7-chat managed block\n?",
    re.S,
)
text = pattern.sub("\n", text).rstrip("\n")
open(path, "w").write(text + "\n\n" + block + "\n")
PY

ufw --force enable
ufw reload

echo
echo "==> Host rules"
ufw status verbose
echo
echo "==> Container rules"
iptables -L DOCKER-USER -n -v --line-numbers
echo
cat <<'EOF'
Verify from somewhere else on the internet:

  curl -sS -o /dev/null -w '%{http_code}\n' https://<domain>/api/health   # 200
  nc -z -w3 <host> 5432 && echo REACHABLE || echo blocked                 # blocked

The DOCKER-USER block survives reboots (it lives in after.rules) and Docker
restarts. Re-run this script after changing which ports should be public.
EOF
