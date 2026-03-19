package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/rogeriocassares/zc8/packages/go-transport-worker"
)

// ============================================================
// SIMPLIFIED UNIFIED TRANSPORT MANAGER
// ============================================================
/*
This is the main entry point that demonstrates the simplified
hybrid approach using the worker pool pattern.

Key Simplifications:
1. Database drives all configuration (team_device_providers)
2. Worker pools are discovered dynamically
3. All transports feed to unified ingest
4. No hard-coded transport logic in main
5. Graceful handling of config changes
6. Per-transport-type workers (not per-team)
*/

func main() {
	// ============================================================
	// INITIALIZATION
	// ============================================================

	// Configuration from environment
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://user:password@localhost/zc8?sslmode=disable"
	}

	// Connect to database
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}
	log.Println("✅ Connected to database")

	// ============================================================
	// UNIFIED INGEST ENDPOINT
	// ============================================================
	// All transports feed messages here
	ingestChan := make(chan interface{}, 1000)
	defer close(ingestChan)

	// Start ingest processor (routes to streams/influxdb/etc)
	go processIngestMessages(ingestChan)

	// ============================================================
	// INITIALIZE WORKER POOLS BY TRANSPORT TYPE
	// ============================================================
	ctx := context.Background()

	// Create worker pools for each transport type
	transportTypes := []string{"mqtt", "grpc", "http_server", "http_client"}
	pools := make(map[string]*transport.WorkerPool)

	for _, transportType := range transportTypes {
		log.Printf("Initializing worker pool for transport: %s", transportType)
		pool := transport.NewWorkerPool(ctx, transportType, db, ingestChan)
		if err := pool.Start(ctx); err != nil {
			log.Printf("Failed to start %s pool: %v", transportType, err)
			continue
		}
		pools[transportType] = pool

		// Log initial workers
		workers := pool.GetWorkers()
		log.Printf("  → Started %d workers for %s", len(workers), transportType)
	}

	// ============================================================
	// MONITORING & METRICS
	// ============================================================
	go monitorWorkerPoolMetrics(pools, 30*time.Second)

	// ============================================================
	// GRACEFUL SHUTDOWN
	// ============================================================
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigChan
	log.Printf("Received signal: %v", sig)

	// Stop all worker pools
	for transportType, pool := range pools {
		log.Printf("Stopping worker pool: %s", transportType)
		pool.Stop()
	}

	log.Println("Transport layer shutdown complete")
}

// ============================================================
// UNIFIED INGEST MESSAGE PROCESSOR
// ============================================================

func processIngestMessages(ingestChan <-chan interface{}) {
	for message := range ingestChan {
		msg := message.(map[string]interface{})

		transportType := msg["transport_type"].(string)
		teamID := msg["team_id"].(int64)
		timestamp := msg["timestamp"].(int64)
		payload := msg["payload"]

		// Log message receipt
		log.Printf("[INGEST] team=%d transport=%s timestamp=%d",
			teamID, transportType, timestamp)

		// Route to appropriate handler
		// In production, this would write to InfluxDB, Kafka, etc
		handleIngestedMessage(transportType, teamID, payload)
	}
}

func handleIngestedMessage(transportType string, teamID int64, payload interface{}) {
	// Example: Could write to InfluxDB, Kafka, or invoke webhook
	// For now, just log
	log.Printf("Processing message from team %d via %s", teamID, transportType)

	// Pseudo-code for production:
	// - Extract device_id from payload
	// - Parse telemetry data
	// - Write to time-series database
	// - Trigger any watching streams
}

// ============================================================
// MONITORING
// ============================================================

func monitorWorkerPoolMetrics(pools map[string]*transport.WorkerPool, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		for transportType, pool := range pools {
			metrics := pool.GetMetrics()
			fmt.Printf("\n[METRICS] Transport: %s\n", transportType)
			fmt.Printf("  Workers: %v\n", metrics["worker_count"])
			fmt.Printf("  Messages: %v\n", metrics["total_messages"])
			fmt.Printf("  Errors: %v\n", metrics["total_errors"])

			// Print per-worker details
			for _, workerMetric := range metrics["workers"].([]map[string]interface{}) {
				fmt.Printf("    - %s: active=%v, messages=%v\n",
					workerMetric["id"],
					workerMetric["active"],
					workerMetric["message_count"])
			}
		}
	}
}

// ============================================================
// DATABASE QUERIES FOR TRANSPORT CONFIGURATION
// ============================================================

/*
The worker discovery uses these database queries:

Query 1: Get all team-provider mappings
-----------------------------------------
SELECT
  tdp.team_id,
  tdp.device_provider_id,
  dp.name as provider_name,
  dp.protocol_type,  -- 'mqtt', 'grpc', 'http_server', 'http_client'
  te.host || ':' || te.port as broker_addr,
  COALESCE(tdp.config, '{}') as config
FROM team_device_providers tdp
JOIN device_providers dp ON tdp.device_provider_id = dp.id
JOIN transport_endpoints te ON tdp.transport_endpoint_id = te.id
WHERE tdp.is_active = true
ORDER BY dp.protocol_type, tdp.team_id;

Query 2: Device count by team and protocol
--------------------------------------------
SELECT
  t.id as team_id,
  t.name as team_name,
  drwt.device_protocol,
  COUNT(*) as device_count
FROM teams t
LEFT JOIN device_registry_with_type drwt
  ON drwt.team_id = t.id AND drwt.is_active = true
GROUP BY t.id, t.name, drwt.device_protocol
ORDER BY t.name, drwt.device_protocol;

Query 3: Team configuration with provider details
---------------------------------------------------
SELECT
  t.name as team_name,
  o.name as organization_name,
  tdp.id as team_provider_id,
  dp.name as provider_name,
  dp.code as provider_code,
  dp.description as provider_description,
  te.host || ':' || te.port as endpoint,
  COUNT(dr.id) as connected_devices
FROM teams t
JOIN organizations o ON t.organization_id = o.id
LEFT JOIN team_device_providers tdp ON t.id = tdp.team_id
LEFT JOIN device_providers dp ON tdp.device_provider_id = dp.id
LEFT JOIN transport_endpoints te ON tdp.transport_endpoint_id = te.id
LEFT JOIN device_registry dr ON t.id = dr.team_id
  AND dr.lns_provider_id = tdp.device_provider_id
GROUP BY t.id, t.name, o.id, o.name, tdp.id, dp.name, dp.code,
         dp.description, te.host, te.port
ORDER BY o.name, t.name;
*/

// ============================================================
// TRANSPORT TYPE CONFIGURATION EXAMPLES
// ============================================================

/*
1. MQTT Configuration Examples
================================

Example 1: ChirpStack Provider (Teams GMS, MauaRacing)
------------------------------------------------------
SELECT * FROM team_device_providers
WHERE device_provider_id = (SELECT id FROM device_providers WHERE code = 'chirpstack');

Expected configuration:
{
  "broker": "networkserver2.maua.br:1883",
  "topics": ["applications/+/devices/+/up"],
  "authentication": {
    "username": "gms-user",
    "password": "secret"
  }
}

Example 2: Direct MQTT (Teams Teams, RaceTracks, Committee)
-----------------------------------------------------------
SELECT * FROM team_device_providers
WHERE device_provider_id = (SELECT id FROM device_providers WHERE code = 'mqtt');

Expected configuration:
{
  "broker": "mqtt.maua.br:1883",
  "topics": ["devices/+/telemetry"],
  "authentication": {
    "username": "team-user",
    "password": "secret"
  }
}


2. gRPC Configuration Examples
===============================

Deployed as multiple instances (NOT one instance with many workers):

Instance 1 (Port 50051) - storio-cli
---
Environment:
  GRPC_PORT=50051
  GRPC_CLIENT_FILTER=storio-*
  GRPC_MAX_WORKERS=10

Instance 2 (Port 50052) - v2n
---
Environment:
  GRPC_PORT=50052
  GRPC_CLIENT_FILTER=v2n-*
  GRPC_MAX_WORKERS=100  # Higher throughput

Instance 3 (Port 50053) - Reserve/Backup
---
Environment:
  GRPC_PORT=50053
  GRPC_CLIENT_FILTER=*
  GRPC_MAX_WORKERS=50


3. HTTP Server Configuration
=============================

Everynet Provider
-----------------
{
  "listen": "0.0.0.0:8081",
  "routes": {
    "POST /devices": "everynet_handler"
  },
  "authentication": "api_key"
}


4. HTTP Client Configuration
============================

Schneider Cloud Provider
------------------------
{
  "endpoint": "https://cloud.schneider.com/devices",
  "method": "POST",
  "authentication": {
    "type": "bearer",
    "token": "***"
  },
  "polling_interval": 60
}
*/

// ============================================================
// SIMPLIFIED vs COMPLEX APPROACHES
// ============================================================

/*
COMPLEX APPROACH (Not Recommended):
===================================
┌─────────────────────────────────┐
│  Main Router                    │
├─────────────────────────────────┤
│ if provider == "chirpstack"     │
│   → RouteToChirpstackLayer()    │
│ else if provider == "mqtt"      │
│   → RouteToDirect MQTT Layer()  │
│ else if provider == "everynet"  │
│   → RouteToEverynetHTTP Layer() │
│ else if provider == "schneider" │
│   → RouteToSchneiderClient()    │
│ ...many more conditions...      │
└─────────────────────────────────┘
Issues:
- Hard to scale
- Hard to add new providers
- Config changes require code changes
- Tight coupling


SIMPLIFIED APPROACH (Recommended):
==================================
┌──────────────────────────────────────┐
│  Database-Driven Worker Pool         │
├──────────────────────────────────────┤
│ For each (transport_type, provider): │
│   Create 1 Worker (MQTT, gRPC, etc)  │
│   Connect to broker/endpoint         │
│   Subscribe to topics/routes         │
│   Feed to unified ingest             │
└──────────────────────────────────────┘
Benefits:
- Configuration via database
- No code changes for new providers
- Easy to scale (add more workers)
- Loose coupling
- Graceful config reloads
- Easy monitoring per transport
- Easy to add team-specific logic


DEPLOYMENT ARCHITECTURE:
========================

┌─────────────────────────────────────────────────────────┐
│                    Main Process                        │
│  Transport Layer + Unified Ingest Endpoint             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐   │
│  │ MQTT Workers │  │ gRPC Workers │  │ HTTP Wrks  │   │
│  │ (dynamic #)  │  │ (3 instances)│  │ (2 workers)│   │
│  └──────────────┘  └──────────────┘  └────────────┘   │
│         │                 │                  │         │
│         └─────────────────┴──────────────────┘         │
│                        │                               │
│              ┌─────────▼──────────┐                    │
│              │ Unified Ingest     │                    │
│              │ Message Handler    │                    │
│              └─────────┬──────────┘                    │
│                        │                               │
│              ┌─────────▼──────────┐                    │
│              │ Backend (InfluxDB, │                    │
│              │   Kafka, Streams)  │                    │
│              └────────────────────┘                    │
└─────────────────────────────────────────────────────────┘

Configuration is entirely in:
- team_device_providers table
- device_providers table
- transport_endpoints table
- device_registry table

No hardcoded transport logic in application code!
*/
