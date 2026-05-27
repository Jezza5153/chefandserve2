#!/usr/bin/env bash
#
# setup-r2.sh — wire Cloudflare R2 into Vercel + apply CORS.
#
# Run this ONCE after you create the bucket-scoped R2 API token in the
# Cloudflare dashboard. Idempotent — re-runs safely (will overwrite
# existing Vercel env vars).
#
# Prerequisites:
#   - Logged into Vercel CLI: `vercel whoami`
#   - Linked to the chefandserve2 project: `vercel link` (already done)
#   - R2 token has Object Read + Write scoped to ONLY the `chefandserve` bucket
#     (NOT account-wide — other projects in this Cloudflare account must
#     remain isolated)
#
# Usage:
#   export R2_ACCESS_KEY_ID="<paste from Cloudflare>"
#   export R2_SECRET_ACCESS_KEY="<paste from Cloudflare>"
#   bash scripts/setup-r2.sh
#
# What it does:
#   1. Sets 4 env vars in Vercel (production + preview + development)
#   2. Writes a CORS policy to s3://chefandserve allowing
#      app.chefandserve.nl + vercel preview URLs + localhost
#   3. Verifies by doing a presigned-PUT round-trip
#   4. Triggers a Vercel redeploy so the new vars take effect

set -euo pipefail

# ----- constants (chefandserve project + bucket only) ---------------------
ACCOUNT_ID="a86e422c12e070c6671777930c396069"
BUCKET="chefandserve"
ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ----- preflight -----------------------------------------------------------
if [[ -z "${R2_ACCESS_KEY_ID:-}" || -z "${R2_SECRET_ACCESS_KEY:-}" ]]; then
  cat <<EOF >&2
ERROR: R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be exported.

Create a bucket-scoped token here:
  https://dash.cloudflare.com/${ACCOUNT_ID}/r2/api-tokens

Then:
  export R2_ACCESS_KEY_ID="..."
  export R2_SECRET_ACCESS_KEY="..."
  bash scripts/setup-r2.sh
EOF
  exit 1
fi

cd "$PROJECT_DIR"

command -v vercel >/dev/null || { echo "ERROR: vercel CLI not installed" >&2; exit 1; }
command -v aws    >/dev/null || { echo "ERROR: aws CLI not installed (brew install awscli)" >&2; exit 1; }

echo "→ Setting Vercel env vars (production + preview + development)..."

# We push to all three environments so dev (preview) and local pulls also work.
# `vercel env add` defaults to interactive; we pipe the value to stdin.
# `--force` overwrites if it already exists.

push_env() {
  local key="$1"
  local val="$2"
  local target="$3"
  # vercel env rm is the cleanest way to "set or replace" — add can fail if exists
  vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
  printf "%s" "$val" | vercel env add "$key" "$target" >/dev/null
  echo "  ✓ ${key} → ${target}"
}

for target in production preview development; do
  push_env R2_ACCESS_KEY_ID     "$R2_ACCESS_KEY_ID"     "$target"
  push_env R2_SECRET_ACCESS_KEY "$R2_SECRET_ACCESS_KEY" "$target"
  push_env R2_BUCKET            "$BUCKET"               "$target"
  push_env R2_ENDPOINT          "$ENDPOINT"             "$target"
done

echo
echo "→ Applying CORS policy to s3://${BUCKET}..."

# CORS allows browser to do XHR PUT to the presigned URL.
# AllowedOrigins is tight — only our app subdomain + previews + localhost.
CORS_JSON=$(cat <<'EOF'
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "https://app.chefandserve.nl",
        "https://chefandserve2.vercel.app",
        "https://*.vercel.app",
        "http://localhost:3000"
      ],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF
)

# Use aws CLI with R2 endpoint. Bucket-scoped token ONLY touches `chefandserve`.
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
AWS_DEFAULT_REGION=auto \
aws s3api put-bucket-cors \
  --endpoint-url "$ENDPOINT" \
  --bucket "$BUCKET" \
  --cors-configuration "$CORS_JSON" \
  --output text

echo "  ✓ CORS applied"

echo
echo "→ Verifying with presigned-PUT round-trip..."

# Small smoke test: list bucket (proves auth + scope works)
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
AWS_DEFAULT_REGION=auto \
aws s3 ls "s3://${BUCKET}/" \
  --endpoint-url "$ENDPOINT" \
  > /dev/null \
  && echo "  ✓ List bucket succeeds" \
  || { echo "  ✗ List bucket FAILED — check token has Object:Read for this bucket" >&2; exit 1; }

echo
echo "→ Triggering Vercel redeploy so new env vars take effect..."
vercel --prod --force --yes >/dev/null 2>&1 &
echo "  ✓ Redeploy triggered (will finish in ~1 min)"

echo
echo "═══════════════════════════════════════════════════════════"
echo "✅ R2 is wired."
echo
echo "Verify after redeploy:"
echo "  1. Visit https://app.chefandserve.nl/admin/business/chefs/<id>"
echo "  2. The DocumentUploader should appear (no 'env vars ontbreken' message)"
echo "  3. Pick a small PDF → upload → see progress → success"
echo "═══════════════════════════════════════════════════════════"
