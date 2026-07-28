#!/usr/bin/env bash
# Run a script against PRODUCTION with the right env, without hand-assembling files.
#
#   scripts/with-prod-env.sh scripts/backfill-embeddings.ts --execute
#
# Why this exists: `vercel env pull` returns the production env but BLANKS the sensitive
# values (OPENAI_API_KEY, AI_CONFIRM_SECRET), so a naive pull fails zod validation on
# startup. This merges the pulled prod env with just those two keys from .env.local,
# runs the script, and shreds the temp file afterwards (also on failure).
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: scripts/with-prod-env.sh <script.ts> [args…]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -t cs-prod-env)"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT INT TERM

# `vercel env pull` only works where the project is LINKED (a .vercel dir). Git worktrees
# do not have one, so fall back to the main worktree — that is where `vercel link` ran.
LINKED="$ROOT"
if [ ! -d "$ROOT/.vercel" ]; then
  MAIN="$(dirname "$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || echo /nonexistent)")"
  if [ -d "$MAIN/.vercel" ]; then LINKED="$MAIN"; fi
fi
if [ ! -d "$LINKED/.vercel" ]; then
  echo "AFGEBROKEN: geen gekoppeld Vercel-project gevonden (draai 'npx vercel link' in de hoofdmap)." >&2
  exit 2
fi

echo "→ productie-omgeving ophalen uit $LINKED …"
if ! (cd "$LINKED" && npx vercel env pull "$TMP.pull" --environment=production --yes >/dev/null); then
  echo "AFGEBROKEN: 'vercel env pull' faalde — ben je ingelogd? ('npx vercel login')" >&2
  exit 2
fi
ENVSRC="$ROOT/.env.local"
[ -f "$ENVSRC" ] || ENVSRC="$LINKED/.env.local"
{
  cat "$TMP.pull"
  # local wins for the two keys Vercel refuses to export (they come back blank)
  grep -E '^(OPENAI_API_KEY|AI_CONFIRM_SECRET)=' "$ENVSRC" || true
} > "$TMP"
rm -f "$TMP.pull"

if ! grep -q 'ep-icy-scene' "$TMP"; then
  echo "AFGEBROKEN: dit lijkt niet de productie-database (ep-icy-scene ontbreekt)." >&2
  exit 2
fi

npx tsx --env-file="$TMP" "$@"
