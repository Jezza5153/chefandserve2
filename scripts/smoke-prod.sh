#!/usr/bin/env bash
# Production smoke test for PR-Z + PR-A + PR-C0 + PR-B + PR-C + PR-D.
# Run AFTER deploying. Checks that public marketing pages render, auth gates
# block unauthed access, and recovery routes are reachable.
#
# Usage: bash scripts/smoke-prod.sh [BASE_URL]
#   BASE_URL defaults to https://chefandserve2.vercel.app
set -u
BASE="${1:-https://chefandserve2.vercel.app}"
echo "Smoke target: $BASE"
echo

pass=0
fail=0

assert_status() {
  local name="$1" url="$2" expected="$3"
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" -L --max-redirs 0 "$url")
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $name → $actual (expected $expected)"
    ((pass+=1)) || true
  else
    echo "  ✗ $name → $actual (expected $expected)"
    ((fail+=1)) || true
  fi
}

assert_contains() {
  local name="$1" url="$2" needle="$3"
  local body
  body=$(curl -s -L "$url")
  if echo "$body" | grep -q "$needle"; then
    echo "  ✓ $name → contains \"$needle\""
    ((pass+=1)) || true
  else
    echo "  ✗ $name → MISSING \"$needle\""
    ((fail+=1)) || true
  fi
}

echo "── public marketing ──"
assert_status "/"                        "$BASE/"                       "200"
assert_status "/contact-us"              "$BASE/contact-us"             "200"
assert_status "/work-with-us"            "$BASE/work-with-us"           "200"
assert_status "/aanmelden"               "$BASE/aanmelden"              "200"

echo
echo "── auth pages render ──"
assert_status "/login"                          "$BASE/login"                          "200"
assert_status "/login/forgot-password"          "$BASE/login/forgot-password"          "200"
assert_status "/login/lost-2fa"                 "$BASE/login/lost-2fa"                 "200"
assert_status "/verify"                         "$BASE/verify"                         "200"

echo
echo "── recovery routes accept tokens ──"
# These are public (token-validated) so 200 with "Link ongeldig" body
assert_contains "/recover/password (no token redirects to /login/forgot-password)" \
  "$BASE/recover/password" "Wachtwoord vergeten\|Vul je e-mailadres"
assert_contains "/recover/password?token=BADTOKEN" \
  "$BASE/recover/password?token=BADTOKEN" "Link ongeldig"
assert_contains "/recover/2fa?token=BADTOKEN" \
  "$BASE/recover/2fa?token=BADTOKEN" "Link ongeldig"

echo
echo "── login page has recovery links ──"
assert_contains "/login has 'Wachtwoord vergeten?' link" \
  "$BASE/login" "Wachtwoord vergeten"
assert_contains "/login has 'Geen toegang tot je authenticator' link" \
  "$BASE/login" "Geen toegang tot je authenticator"

echo
echo "── admin gated ──"
# Unauthed → redirect to /login. We allow 1 redirect so we see the 200 on /login.
assert_status "/admin (unauthed → 307 to /login)"           "$BASE/admin"                  "307"
assert_status "/admin/system/users (unauthed → 307)"        "$BASE/admin/system/users"     "307"

echo
echo "── /api/health ──"
assert_contains "/api/health returns status=healthy"  "$BASE/api/health" "\"status\":\"healthy\""
assert_contains "/api/health database=ok"             "$BASE/api/health" "\"database\":\"ok\""

echo
echo "─────────────────────────────"
echo "  ✓ pass: $pass"
echo "  ✗ fail: $fail"
if (( fail > 0 )); then
  echo "  RESULT: FAILED — $fail check(s)"
  exit 1
fi
echo "  RESULT: OK"
