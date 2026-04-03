#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"
PRIMARY_NAME="${1:-$(hostname -f 2>/dev/null || hostname)}"
EXTRA_SANS="${2:-}"
TMP_CONFIG="$(mktemp)"

mkdir -p "${CERT_DIR}"

collect_local_ips() {
  hostname -I 2>/dev/null | tr ' ' '\n' | awk 'NF'
}

declare -a SAN_ENTRIES
SAN_ENTRIES+=("DNS:${PRIMARY_NAME}")
SAN_ENTRIES+=("DNS:localhost")
SAN_ENTRIES+=("IP:127.0.0.1")

while IFS= read -r ip; do
  [[ -n "${ip}" ]] && SAN_ENTRIES+=("IP:${ip}")
done < <(collect_local_ips)

if [[ -n "${EXTRA_SANS}" ]]; then
  IFS=',' read -ra extras <<< "${EXTRA_SANS}"
  for entry in "${extras[@]}"; do
    trimmed="$(echo "${entry}" | xargs)"
    [[ -z "${trimmed}" ]] && continue
    if [[ "${trimmed}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
      SAN_ENTRIES+=("IP:${trimmed}")
    else
      SAN_ENTRIES+=("DNS:${trimmed}")
    fi
  done
fi

unique_sans="$(printf '%s\n' "${SAN_ENTRIES[@]}" | awk '!seen[$0]++' | paste -sd, -)"

cat > "${TMP_CONFIG}" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
CN = ${PRIMARY_NAME}

[v3_req]
subjectAltName = ${unique_sans}
extendedKeyUsage = serverAuth
keyUsage = digitalSignature,keyEncipherment
EOF

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -days 825 \
  -keyout "${CERT_DIR}/asterisk.key" \
  -out "${CERT_DIR}/asterisk.crt" \
  -config "${TMP_CONFIG}"

rm -f "${TMP_CONFIG}"

echo "Certificados gerados em ${CERT_DIR}"
echo "SANs: ${unique_sans}"
