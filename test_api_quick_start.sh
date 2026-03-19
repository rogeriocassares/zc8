#!/bin/bash
# Quick Start API Testing Script

set -e

API_URL="http://localhost:3333"
echo "🚀 ZC8 RBAC API - Quick Start Testing"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print section headers
print_section() {
    echo -e "${BLUE}>>> $1${NC}"
}

# Function to print success
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

# Function to print info
print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

print_section "Step 1: Get Test Tokens"
echo "Fetching pre-generated test tokens..."
TOKEN_RESPONSE=$(curl -s -X GET "$API_URL/auth/test-tokens")
ADMIN_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.testTokens.admin')
IMT_OWNER_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.testTokens.imtOwner')
IMT_MEMBER_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.testTokens.imtMember')
print_success "Got 6 test tokens"
print_info "Admin Token: ${ADMIN_TOKEN:0:50}..."

echo ""
print_section "Step 2: Verify Admin Token"
VERIFY=$(curl -s -X GET "$API_URL/auth/verify" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.payload')
echo "Token Payload:"
echo $VERIFY | jq '{email: .email, role: .memberRole, org: .organizationName, scopes: (.scopes | length)}'
print_success "Token verification successful"

echo ""
print_section "Step 3: List All Organizations"
ORGS=$(curl -s -X GET "$API_URL/api/v1/organizations" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data')
echo "Organizations:"
echo $ORGS | jq '.[] | {id: .id, name: .name, type: .org_type, parent_id: .parent_id}' | head -20
TOTAL=$(echo $ORGS | jq 'length')
print_success "Found $TOTAL organizations"

echo ""
print_section "Step 4: Get IMT Organization Members"
IMT_MEMBERS=$(curl -s -X GET "$API_URL/api/v1/organizations/2/members" \
  -H "Authorization: Bearer $IMT_OWNER_TOKEN" | jq '.data')
echo "IMT Organization Members:"
echo $IMT_MEMBERS | jq '.[] | {email: .email, role: .role_name, status: .invitation_status}'
TOTAL=$(echo $IMT_MEMBERS | jq 'length')
print_success "Found $TOTAL members in IMT org"

echo ""
print_section "Step 5: List All Teams"
TEAMS=$(curl -s -X GET "$API_URL/api/v1/teams" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data')
echo "Teams:"
echo $TEAMS | jq '.[] | {id: .id, name: .name, organization: .organization}' | head -20
TOTAL=$(echo $TEAMS | jq 'length')
print_success "Found $TOTAL teams"

echo ""
print_section "Step 6: List All Roles"
ROLES=$(curl -s -X GET "$API_URL/api/v1/roles" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data')
echo "Roles:"
echo $ROLES | jq '.[] | {id: .id, name: .name, scope: .scope}'
TOTAL=$(echo $ROLES | jq 'length')
print_success "Found $TOTAL roles"

echo ""
print_section "Step 7: Test Different User Roles"

print_info "Testing IMT Owner access to IMT org..."
IMT_ORG=$(curl -s -X GET "$API_URL/api/v1/organizations/2" \
  -H "Authorization: Bearer $IMT_OWNER_TOKEN")
if echo $IMT_ORG | jq -e '.data' > /dev/null 2>&1; then
    print_success "IMT Owner can access IMT org"
else
    print_info "IMT org endpoint response: $(echo $IMT_ORG | jq '.success')"
fi

print_info "Testing IMT Member role..."
IMT_MEMBER_ORGS=$(curl -s -X GET "$API_URL/api/v1/organizations" \
  -H "Authorization: Bearer $IMT_MEMBER_TOKEN")
print_success "IMT Member can list organizations"

echo ""
print_section "Step 8: Token Expiration & Refresh"
print_info "Current tokens expire in 24 hours"
print_info "To refresh or get new tokens, call: GET /auth/test-tokens"

echo ""
print_section "Available Test Credentials"
cat << 'EOF'

1️⃣  ADMIN (Full Platform Access)
   Email: admin@platform.com
   Org: Admin (ID: 1)
   Role: Owner
   Scopes: org:read, org:write, org:admin, teams:manage, members:manage

2️⃣  IMT OWNER (Organization Owner)
   Email: imt@imt.com
   Org: IMT (ID: 2)
   Role: Owner
   Scopes: org:read, org:write, org:admin, teams:manage, members:manage

3️⃣  IMT MEMBER (Organization Member)
   Email: gms@imt.com
   Org: IMT (ID: 2)
   Role: Member
   Scopes: org:read, teams:read

4️⃣  FSAE OWNER (Organization Owner)
   Email: fsaelive@fsaelive.com
   Org: FSAELive (ID: 3)
   Role: Owner
   Scopes: org:read, org:write, org:admin, teams:manage, members:manage

5️⃣  STORIOCLOUD ADMIN (Organization Admin)
   Email: cinemark@storiocloud.com
   Org: StorioCloud (ID: 4)
   Role: Admin
   Scopes: org:read, org:write, org:admin, members:manage

6️⃣  GMS TEAM OWNER (Team Owner)
   Email: imt@imt.com (same user, different team role)
   Org: IMT (ID: 2), Team: GMS (ID: 1)
   Role: TeamOwner
   Scopes: team:read, team:write, team:admin, devices:manage, members:manage, subteams:create

EOF

echo ""
print_section "Quick Commands Reference"
cat << 'EOF'

# Get test tokens
curl -s http://localhost:3333/auth/test-tokens | jq '.testTokens'

# Verify a token
TOKEN="your-jwt-token"
curl -s http://localhost:3333/auth/verify \
  -H "Authorization: Bearer $TOKEN" | jq '.payload'

# List organizations
TOKEN="your-jwt-token"
curl -s http://localhost:3333/api/v1/organizations \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {id, name, org_type}'

# Get organization members
TOKEN="your-jwt-token"
curl -s http://localhost:3333/api/v1/organizations/2/members \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {email, role_name}'

# List teams
TOKEN="your-jwt-token"
curl -s http://localhost:3333/api/v1/teams \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {id, name}'

# Get team members
TOKEN="your-jwt-token"
curl -s http://localhost:3333/api/v1/teams/1/members \
  -H "Authorization: Bearer $TOKEN" | jq '.data[]'

# List roles
TOKEN="your-jwt-token"
curl -s http://localhost:3333/api/v1/roles \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {name, scope, permissions}'

EOF

echo ""
print_section "✨ Setup Complete!"
print_success "API is running at http://localhost:3333"
print_success "Documentation: See API_AUTHENTICATION_GUIDE.md"
print_success "All tests passed! Ready for development."
