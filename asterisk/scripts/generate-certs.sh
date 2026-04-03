#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"
HOSTNAME="${1:-pbx.local.lan}"
LOCAL_IP="${2:-}"

mkdir -p "${CERT_DIR}"

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -days 825 \
  -keyout "${CERT_DIR}/asterisk.key" \
  -out "${CERT_DIR}/asterisk.crt" \
  -subj "/CN=${HOSTNAME}" \
  -addext "subjectAltName=DNS:${HOSTNAME}${LOCAL_IP:+,IP:${LOCAL_IP}}" \
  -addext "extendedKeyUsage=serverAuth" \
  -addext "keyUsage=digitalSignature,keyEncipherment"

echo "Certificados gerados em ${CERT_DIR} para ${HOSTNAME}"

