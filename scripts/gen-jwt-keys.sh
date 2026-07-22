#!/usr/bin/env bash
set -euo pipefail
OUT="${1:-./keys-dev}"
mkdir -p "$OUT"
openssl genrsa -out "$OUT/jwt-private.pem" 2048
openssl rsa -in "$OUT/jwt-private.pem" -pubout -out "$OUT/jwt-public.pem"
echo "Wrote $OUT/jwt-private.pem and $OUT/jwt-public.pem"
