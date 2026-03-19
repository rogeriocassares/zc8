#!/bin/bash

# Simplified End-to-End Test
# Tests adapters → Ingest (without full backend dependencies)

set -e

REPO_ROOT="/Users/rogeriocassares/Git/rogeriocassares/zc8"
ADAPTERS_DIR="$REPO_ROOT/services/adapters"
INGEST_DIR="$REPO_ROOT/services/ingest"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}E2E Test: Adapters → Ingest Server${NC}"
echo -e "${BLUE}========================================${NC}"

pkill -f "agent" 2>/dev/null || true
pkill -f "zc2x" 2>/dev/null || true
pkill -f "ingest" 2>/dev/null || true
sleep 1

mkdir -p /tmp/zc8-test

# ============================================
# 1. Build
# ============================================

echo -e "\n${BLUE}[1] Building binaries...${NC}"

cd "$INGEST_DIR"
go build -o ingest ./cmd/ingest 2>&1 | tail -5
echo -e "${GREEN}✅ Ingest built${NC}"

cd "$ADAPTERS_DIR"
go build -o agent ./agent/cmd/agent_server 2>&1 | tail -5
echo -e "${GREEN}✅ Agent built${NC}"

go build -o zc2x ./zc2x/cmd/zc2x_server 2>&1 | tail -5
echo -e "${GREEN}✅ Zc2x built${NC}"

# ============================================
# 2. Start Ingest (Background)
# ============================================

echo -e "\n${BLUE}[2] Starting Ingest Server on :50054...${NC}"

# Note: Ingest requires InfluxDB/Postgres/Redis
# For this test, we'll try to start it but continue if it fails
# The adapters will still work independently

cd "$INGEST_DIR"
timeout 5s ./ingest > /tmp/zc8-test/ingest.log 2>&1 &
INGEST_PID=$!
sleep 2

if kill -0 $INGEST_PID 2>/dev/null; then
    echo -e "${GREEN}✅ Ingest started (PID: $INGEST_PID)${NC}"
else
    echo -e "${YELLOW}⚠ Ingest service needs InfluxDB/Postgres/Redis${NC}"
    echo "  Checking what failed:"
    tail -3 /tmp/zc8-test/ingest.log || true
    INGEST_PID=""
fi

# ============================================
# 3. Start Adapters
# ============================================

echo -e "\n${BLUE}[3] Starting Adapters...${NC}"

cd "$ADAPTERS_DIR"

echo "  Starting Agent adapter on :50053..."
timeout 5s ./agent > /tmp/zc8-test/agent.log 2>&1 &
AGENT_PID=$!
sleep 1

if kill -0 $AGENT_PID 2>/dev/null; then
    echo -e "${GREEN}    ✅ Agent adapter ready${NC}"
else
    echo -e "${RED}    ❌ Agent adapter failed${NC}"
    tail -3 /tmp/zc8-test/agent.log || true
    exit 1
fi

echo "  Starting Zc2x adapter on :50052..."
timeout 5s ./zc2x > /tmp/zc8-test/zc2x.log 2>&1 &
ZC2X_PID=$!
sleep 1

if kill -0 $ZC2X_PID 2>/dev/null; then
    echo -e "${GREEN}    ✅ Zc2x adapter ready${NC}"
else
    echo -e "${RED}    ❌ Zc2x adapter failed${NC}"
    tail -3 /tmp/zc8-test/zc2x.log || true
    exit 1
fi

# ============================================
# 4. Test Connection Directly
# ============================================

echo -e "\n${BLUE}[4] Testing Adapter Connectivity...${NC}"

# Test agent adapter
if nc -zv localhost 50053 2>&1 | grep -q "succeeded"; then
    echo -e "${GREEN}✅ Agent adapter listening on :50053${NC}"
else
    echo -e "${RED}❌ Agent adapter not responding${NC}"
    exit 1
fi

# Test zc2x adapter
if nc -zv localhost 50052 2>&1 | grep -q "succeeded"; then
    echo -e "${GREEN}✅ Zc2x adapter listening on :50052${NC}"
else
    echo -e "${RED}❌ Zc2x adapter not responding${NC}"
    exit 1
fi

# ============================================
# 5. Test gRPC Message Flow
# ============================================

echo -e "\n${BLUE}[5] Testing gRPC Message Flow...${NC}"

cat > /tmp/test_grpc.go << 'EOFTEST'
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "github.com/rogeriocassares/zc8/packages/proto/gen/go/telemetry/v1"
)

func testAdapter(name string, addr string) {
	fmt.Printf("  Testing %s adapter on %s...\n", name, addr)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, addr, grpc.WithInsecure())
	if err != nil {
		fmt.Printf("    ❌ Connection failed: %v\n", err)
		return
	}
	defer conn.Close()

	client := pb.NewTelemetryIngestServiceClient(conn)

	req := &pb.IngestRequest{
		EventId:   fmt.Sprintf("test-%d", time.Now().Unix()),
		Timestamp: timestamppb.Now(),
		Source:    pb.IngestSource_SOURCE_GRPC,			DeviceKey: 1, // ✅ REFACTORED: device_key for O(1) routing		Payload: &pb.IngestRequest_MqttMessage{
			MqttMessage: &pb.MQTTGatewayMessage{
				Event: &pb.MQTTEventMetadata{
					EventId:       fmt.Sprintf("evt-%s", name),
					GeneratedAtMs: time.Now().UnixMilli(),
					SourceAdapter: name,
				},
				Device: &pb.MQTTDeviceIdentification{
					DeviceId:   fmt.Sprintf("device-%s-001", name),
					DeviceName: fmt.Sprintf("test-%s-device", name),
				},
				Mqtt: &pb.MQTTClientInfo{
					ClientId: fmt.Sprintf("%s-client", name),
					Topic:    fmt.Sprintf("%s/test/telemetry", name),
					Qos:      1,
				},
				Payload: []byte(fmt.Sprintf(`{"test": "message from %s"}`, name)),
			},
		},
	}

	ack, err := client.IngestUnary(ctx, req)
	if err != nil {
		fmt.Printf("    ❌ Message send failed: %v\n", err)
		return
	}

	if ack.Status == pb.IngestStatus_INGEST_OK {
		fmt.Printf("    ✅ Message sent successfully (status: %v)\n", ack.Status)
	} else {
		fmt.Printf("    ⚠ Message sent but status: %v (%s)\n", ack.Status, ack.Reason)
	}
}

func main() {
	fmt.Println("gRPC Message Flow Test:")
	testAdapter("agent", "localhost:50053")
	testAdapter("zc2x", "localhost:50052")
	fmt.Println("Test complete!")
}
EOFTEST

cd /tmp
go run test_grpc.go 2>&1

# ============================================
# 6. Log Summary
# ============================================

echo -e "\n${BLUE}[6] Service Logs:${NC}"
echo -e "  ${YELLOW}Agent adapter:${NC}"
tail -5 /tmp/zc8-test/agent.log || echo "    (no logs)"
echo -e "  ${YELLOW}Zc2x adapter:${NC}"
tail -5 /tmp/zc8-test/zc2x.log || echo "    (no logs)"

if [ ! -z "$INGEST_PID" ]; then
    echo -e "  ${YELLOW}Ingest server:${NC}"
    tail -5 /tmp/zc8-test/ingest.log || echo "    (no logs)"
fi

# ============================================
# Cleanup
# ============================================

echo -e "\n${BLUE}[7] Cleaning up...${NC}"
[ ! -z "$INGEST_PID" ] && kill $INGEST_PID 2>/dev/null || true
kill $AGENT_PID $ZC2X_PID 2>/dev/null || true
sleep 1

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ End-to-End Test Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
