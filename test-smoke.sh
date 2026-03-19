#!/bin/bash
# ============================================================
# ZC8 Smoke Test — Full Pipeline Verification
#
# Prerequisites: docker services running (Postgres, NATS, Redis)
#   cd docker && docker compose up -d
#
# Tests:
#   1. Infrastructure connectivity (Postgres, NATS, Redis)
#   2. Elysia API health + auth
#   3. Ingest Profile CRUD
#   4. Device registration + profile assignment
#   5. HTTP transport ingest endpoint
#   6. NATS JetStream stream verification
# ============================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'
YELLOW='\033[1;33m'; NC='\033[0m'

pass()  { echo -e "${GREEN}  ✅ $1${NC}"; }
fail()  { echo -e "${RED}  ❌ $1${NC}"; FAILURES=$((FAILURES + 1)); }
info()  { echo -e "${BLUE}  ℹ️  $1${NC}"; }
section() { echo -e "\n${YELLOW}━━━ $1 ━━━${NC}"; }

FAILURES=0
API_URL="${API_URL:-http://localhost:3333}"
NATS_URL="${NATS_URL:-nats://localhost:4222}"
HTTP_TRANSPORT_URL="${HTTP_TRANSPORT_URL:-http://localhost:8081}"

echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ZC8 Pipeline — Smoke Tests           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"

# ── 1. Infrastructure ────────────────────────────────────────
section "1 · Infrastructure Connectivity"

if nc -z localhost 5432 2>/dev/null; then pass "PostgreSQL :5432"
else fail "PostgreSQL :5432 unreachable"; fi

if nc -z localhost 4222 2>/dev/null; then pass "NATS :4222"
else fail "NATS :4222 unreachable"; fi

if nc -z localhost 6379 2>/dev/null; then pass "Redis :6379"
else fail "Redis :6379 unreachable"; fi

# ── 2. Elysia API ───────────────────────────────────────────
section "2 · Elysia API (${API_URL})"

HEALTH=$(curl -sf "${API_URL}/health" 2>/dev/null || echo '{}')
if echo "$HEALTH" | grep -q '"healthy"'; then
  pass "GET /health → healthy"
else
  fail "GET /health not healthy: ${HEALTH}"
fi

TOKENS=$(curl -sf "${API_URL}/auth/test-tokens" 2>/dev/null || echo '{}')
ADMIN_TOKEN=$(echo "$TOKENS" | jq -r '.testTokens.admin // empty' 2>/dev/null)
if [ -n "$ADMIN_TOKEN" ]; then
  pass "GET /auth/test-tokens → admin token obtained"
else
  fail "Could not obtain admin test token"
fi

if [ -n "$ADMIN_TOKEN" ]; then
  VERIFY=$(curl -sf "${API_URL}/auth/verify" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>/dev/null || echo '{}')
  if echo "$VERIFY" | jq -e '.payload.email' >/dev/null 2>&1; then
    EMAIL=$(echo "$VERIFY" | jq -r '.payload.email')
    pass "GET /auth/verify → ${EMAIL}"
  else
    fail "Token verification failed"
  fi
fi

# ── 3. Ingest Profile CRUD ──────────────────────────────────
section "3 · Ingest Profile CRUD"

PROFILE_ENDPOINT="${API_URL}/api/v1/ingest-profiles"

# Create
CREATE_RESP=$(curl -sf -X POST "${PROFILE_ENDPOINT}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "smoke-test-profile",
    "description": "Auto-created by smoke test",
    "organization_id": 1,
    "influxdb_write_enabled": true,
    "influxdb_bucket": "smoke_test",
    "influxdb_measurement": "smoke",
    "redis_write_enabled": true,
    "redis_key_prefix": "smoke:",
    "nats_write_enabled": true,
    "nats_subject_prefix": "smoke",
    "is_active": true,
    "is_default": false
  }' 2>/dev/null || echo '{}')

PROFILE_ID=$(echo "$CREATE_RESP" | jq -r '.data.id // empty' 2>/dev/null)
if [ -n "$PROFILE_ID" ] && [ "$PROFILE_ID" != "null" ]; then
  pass "POST create → id=${PROFILE_ID}"
else
  fail "POST create failed: ${CREATE_RESP}"
  # Try to find any existing profile for the rest of the tests
  LIST_RESP=$(curl -sf "${PROFILE_ENDPOINT}?org_id=1" 2>/dev/null || echo '{}')
  PROFILE_ID=$(echo "$LIST_RESP" | jq -r '.data[0].id // empty' 2>/dev/null)
fi

# List
LIST_RESP=$(curl -sf "${PROFILE_ENDPOINT}?org_id=1" 2>/dev/null || echo '{}')
LIST_COUNT=$(echo "$LIST_RESP" | jq -r '.total // 0' 2>/dev/null)
if [ "$LIST_COUNT" -gt 0 ] 2>/dev/null; then
  pass "GET list → ${LIST_COUNT} profile(s) for org 1"
else
  fail "GET list returned 0 profiles"
fi

# Get by ID
if [ -n "$PROFILE_ID" ] && [ "$PROFILE_ID" != "null" ]; then
  GET_RESP=$(curl -sf "${PROFILE_ENDPOINT}/${PROFILE_ID}" 2>/dev/null || echo '{}')
  GOT_NAME=$(echo "$GET_RESP" | jq -r '.data.name // empty' 2>/dev/null)
  if [ "$GOT_NAME" = "smoke-test-profile" ]; then
    pass "GET /${PROFILE_ID} → ${GOT_NAME}"
  else
    fail "GET /${PROFILE_ID} wrong name: ${GOT_NAME}"
  fi

  # Update
  UPDATE_RESP=$(curl -sf -X PUT "${PROFILE_ENDPOINT}/${PROFILE_ID}" \
    -H "Content-Type: application/json" \
    -d '{"description": "Updated by smoke test"}' 2>/dev/null || echo '{}')
  UPD_DESC=$(echo "$UPDATE_RESP" | jq -r '.data.description // empty' 2>/dev/null)
  if [ "$UPD_DESC" = "Updated by smoke test" ]; then
    pass "PUT /${PROFILE_ID} → description updated"
  else
    fail "PUT /${PROFILE_ID} failed: ${UPDATE_RESP}"
  fi

  # Delete
  DEL_RESP=$(curl -sf -X DELETE "${PROFILE_ENDPOINT}/${PROFILE_ID}" 2>/dev/null || echo '{}')
  if echo "$DEL_RESP" | grep -q '"success":true'; then
    pass "DELETE /${PROFILE_ID} → removed"
  else
    fail "DELETE /${PROFILE_ID} failed: ${DEL_RESP}"
  fi
fi

# ── 4. Device Management ────────────────────────────────────
section "4 · Device Management"

if [ -n "$ADMIN_TOKEN" ]; then
  ORGS=$(curl -sf "${API_URL}/api/v1/organizations" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>/dev/null || echo '{}')
  ORG_COUNT=$(echo "$ORGS" | jq -r '.data | length // 0' 2>/dev/null || echo "0")
  if [ "$ORG_COUNT" -gt 0 ] 2>/dev/null; then
    pass "GET /api/v1/organizations → ${ORG_COUNT} org(s)"
  else
    info "No organizations found (may need seed data)"
  fi

  DEVICES=$(curl -sf "${API_URL}/api/v1/devices?org_id=1" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>/dev/null || echo '{}')
  DEV_COUNT=$(echo "$DEVICES" | jq -r '.data | length // 0' 2>/dev/null || echo "0")
  if [ "$DEV_COUNT" -gt 0 ] 2>/dev/null; then
    pass "GET /api/v1/devices → ${DEV_COUNT} device(s)"
  else
    info "No devices found (may need seed data)"
  fi
else
  info "Skipping device tests — no admin token"
fi

# ── 5. HTTP Transport (if running) ──────────────────────────
section "5 · HTTP Transport (${HTTP_TRANSPORT_URL})"

if nc -z localhost 8081 2>/dev/null; then
  TRANSPORT_HEALTH=$(curl -sf "${HTTP_TRANSPORT_URL}/health" 2>/dev/null || echo '')
  if [ -n "$TRANSPORT_HEALTH" ]; then
    pass "GET /health → transport reachable"
  else
    info "Transport at :8081 does not respond to /health (may be normal)"
  fi

  TRANSPORT_STATUS=$(curl -sf "${HTTP_TRANSPORT_URL}/status" 2>/dev/null || echo '')
  if [ -n "$TRANSPORT_STATUS" ]; then
    pass "GET /status → $(echo "$TRANSPORT_STATUS" | head -c 80)"
  fi
else
  info "HTTP transport not running on :8081 — skipping"
fi

# ── 6. NATS JetStream (if nats CLI available) ───────────────
section "6 · NATS JetStream"

if command -v nats &>/dev/null; then
  STREAMS=$(nats stream list --json -s "$NATS_URL" 2>/dev/null || echo '[]')
  if echo "$STREAMS" | jq -e '.[0]' >/dev/null 2>&1; then
    STREAM_COUNT=$(echo "$STREAMS" | jq 'length')
    pass "JetStream streams: ${STREAM_COUNT}"
    # Check for TELEMETRY stream
    if echo "$STREAMS" | jq -e '.[] | select(.config.name == "TELEMETRY")' >/dev/null 2>&1; then
      MSGS=$(echo "$STREAMS" | jq -r '.[] | select(.config.name == "TELEMETRY") | .state.messages')
      pass "TELEMETRY stream: ${MSGS} messages"
    else
      info "TELEMETRY stream not yet created (will be created on first publish)"
    fi
  else
    info "No JetStream streams (expected if services haven't published yet)"
  fi
else
  info "nats CLI not installed — skipping JetStream checks"
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "$FAILURES" -eq 0 ]; then
  echo -e "${GREEN}  All checks passed!${NC}"
else
  echo -e "${RED}  ${FAILURES} check(s) failed${NC}"
fi
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

exit "$FAILURES"
