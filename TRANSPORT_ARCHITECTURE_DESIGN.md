/\*
Transport Layer Architecture - Simplified Hybrid Approach

Problem: Multiple transport types (gRPC, MQTT, HTTP) with different configurations
based on provider and team requirements

Solution: Worker Pool Pattern per Transport Type + Team
with Device-Provider-based routing

Key Principles:

1. One worker type per transport protocol (gRPC, MQTT, HTTP)
2. Multiple instances ONLY for isolation (storio-cli vs v2n)
3. Dynamic configuration from team_device_providers table
4. Single unified entry point for all data
5. Adapter pattern for protocol-specific logic
   \*/

// ============================================================
// ARCHITECTURE OVERVIEW
// ============================================================

/\*
Database Layer (Source of Truth):
├── organizations
├── teams
├── device_providers (chirpstack, everynet, schneider, mqtt, etc)
├── team_device_providers (team → provider mapping)
├── device_registry (actual devices)
└── streams (ingest targets)

Transport Layer (Processing):
├── WorkerManager (coordinator)
├── WorkerRegistry (tracks all active workers)
├── Adapters by Transport Type:
│ ├── GRPCAdapter
│ ├── MQTTAdapter
│ ├── HTTPServerAdapter
│ └── HTTPClientAdapter
└── TeamConfig (lazy-loaded from DB)

Ingest Layer (Destination):
└── Unified ingest endpoint (all transports feed here)
\*/

// ============================================================
// RECOMMENDED: MULTIPLE INSTANCES FOR gRPC SERVER
// (NOT many workers in 1 instance)
// ============================================================

/\*
Why Multiple Instances?
========================

Option A: 1 Instance + Many Workers (NOT recommended)

- ❌ Single point of failure (storio-cli loses all connections)
- ❌ Resource contention (high-throughput v2n blocks other clients)
- ❌ Harder to scale independently
- ❌ Complex load balancing logic needed

Option B: 2 Instances (RECOMMENDED)

- ✅ Isolation by data throughput profile
- ✅ Independent scaling
- ✅ Fault isolation (v2n crash doesn't affect storio-cli)
- ✅ Easier monitoring and debugging
- ✅ Better resource utilization

Architecture:
┌─────────────────────────┐
│ gRPC Load Balancer │
│ (DNS: grpc.maua.br) │
└──────┬──────────────────┘
│
├─────────────────────────────┬──────────────────────────────┐
│ │ │
┌───▼────────────┐ ┌────▼────────────┐ ┌─────▼─────────┐
│ gRPC Instance1 │ │ gRPC Instance2 │ │ gRPC Instance3│
│ Port 50051 │ │ Port 50052 │ │ Port 50053 │
│ storio-cli │ │ v2n │ │ (Reserve) │
│ Workers: 10 │ │ Workers: 100 │ │ Workers: 10 │
└───┬────────────┘ └────┬────────────┘ └─────┬─────────┘
│ │ │
└─────────────────────────────┼──────────────────────────────┘
│
┌────────▼────────┐
│ Unified Ingest │
│ Endpoint │
└─────────────────┘

Configuration per Instance:

- Instance 1 (50051): clientID filter = 'storio-\*'
- Instance 2 (50052): clientID filter = 'v2n-\*'
- Instance 3 (50053): Backup/future

Kubernetes (Recommended Deployment):
deployment "grpc-storio" (1-3 replicas)
deployment "grpc-v2n" (2-5 replicas, auto-scale based on throughput)
service "grpc-pool" (DNS round-robin)
\*/

// ============================================================
// MQTT PROVIDER CONFIGURATION
// ============================================================

/\*
MQTT Subscriber Configuration by Provider
===========================================

Database Setup:
┌─────────────────────────────────────────────────────────────┐
│ team_device_providers │
├─────────────────────────────────────────────────────────────┤
│ team_id │ provider_id │ transport_endpoint_id │ config │
├─────────┼─────────────┼───────────────────────┼─────────────┤
│ GMS(1) │ ChirpStack │ ns2.maua.br:1883 │ {...} │
│ MR(2) │ ChirpStack │ ns2.maua.br:1883 │ {...} │
│ Teams(3)│ MQTT Direct │ mqtt.maua.br:1883 │ {...} │
│ RT(4) │ MQTT Direct │ mqtt.maua.br:1883 │ {...} │
└─────────────────────────────────────────────────────────────┘

Configuration by Scenario:
\*/

// Scenario 1: ChirpStack Provider
// Team GMS and MauaRacing use Network Server
MQTTConfig_ChirpStack = {
broker: "networkserver2.maua.br",
port: 1883,
topics: ["applications/+/devices/+/up"], // Standard ChirpStack topic
authentication: {
username: "gms-team", // or "mauaracing-team"
password: "\*\*\*" // from team_device_providers config
},
onMessage: (topic, payload) => {
// Extract team from connection
// Extract device from topic
// Route to unified ingest
}
}

// Scenario 2: MQTT Direct (No provider)
// Teams and Committee use direct MQTT
MQTTConfig_Direct = {
broker: "mqtt.maua.br",
port: 1883,
topics: ["devices/+/telemetry"], // Custom topic pattern
authentication: {
username: "team-credential",
password: "\*\*\*" // from environment or DB
},
onMessage: (topic, payload) => {
// Extract device from topic (devices/{device_id}/telemetry)
// Route to unified ingest
}
}

/\*
Simplified Pattern:

1. Single MQTT Worker Manager
2. Load team_device_providers from DB (cached, refresh every 5 min)
3. For each team with MQTT provider:
   - Extract broker address from transport_endpoint_id
   - Connect once per unique broker (connection pooling)
   - Subscribe to both patterns (ChirpStack + Direct)
   - Route internally based on topic pattern
4. If team changes provider, reload config (graceful reconnect)
   \*/
