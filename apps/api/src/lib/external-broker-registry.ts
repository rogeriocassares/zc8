/**
 * Adapter Broker/Endpoint Registry
 *
 * Tracks all external broker and endpoint connections per adapter
 * - MQTT Adapter → [broker1, broker2, broker3]
 * - HTTP Adapter → [endpoint1, endpoint2]
 * - LNS Adapter → internal MQTT + internal HTTP
 */

import type { AdapterType, AdapterVendor } from "./adapter-types.ts";

export enum ExternalConnectionType {
  MQTT_BROKER = "mqtt_broker",
  HTTP_ENDPOINT = "http_endpoint",
  GRPC_SERVER = "grpc_server",
  DATABASE = "database",
}

export enum ConnectionStatus {
  CONNECTED = "connected",
  CONNECTING = "connecting",
  DISCONNECTED = "disconnected",
  ERROR = "error",
  UNKNOWN = "unknown",
}

export interface ExternalBrokerConnection {
  id: string; // UUID
  organization_id: number;
  adapter_instance_id?: string; // Reference to running adapter instance

  adapter_type: AdapterType;
  adapter_vendor: AdapterVendor;

  connection_type: ExternalConnectionType;
  connection_url: string; // "tcp://broker1:1883" or "https://api.example.com"

  // Connection metadata
  broker_host?: string; // "broker1.example.com"
  broker_port?: number; // 1883
  credentials?: {
    username?: string;
    password?: string;
    api_key?: string;
    token?: string;
  };

  connection_status: ConnectionStatus;
  last_error?: string;
  last_connected_at?: Date;
  connection_attempts: number;
  messages_sent: number;
  messages_received: number;
  bytes_sent: number;
  bytes_received: number;

  // Config
  retry_enabled: boolean;
  retry_interval_sec: number;
  max_retries: number;
  timeout_sec: number;
  keep_alive_sec?: number; // For MQTT
  tls_enabled: boolean;
  tls_verify: boolean;

  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AdapterBrokerRegistration {
  adapter_config_id: string;
  adapter_instance_id?: string;
  broker_connections: ExternalBrokerConnection[];
}

export class ExternalBrokerRegistry {
  private connections: Map<string, ExternalBrokerConnection[]> = new Map();

  /**
   * Register a new broker/endpoint for an adapter
   */
  registerBroker(
    adapterConfigId: string,
    connection: ExternalBrokerConnection,
  ): void {
    const key = adapterConfigId;
    if (!this.connections.has(key)) {
      this.connections.set(key, []);
    }
    this.connections.get(key)!.push(connection);
  }

  /**
   * Get all brokers for an adapter
   */
  getBrokers(adapterConfigId: string): ExternalBrokerConnection[] {
    return this.connections.get(adapterConfigId) || [];
  }

  /**
   * Get connected brokers only
   */
  getConnectedBrokers(adapterConfigId: string): ExternalBrokerConnection[] {
    return (
      this.connections.get(adapterConfigId) || []
    ).filter(
      (b) =>
        b.connection_status === ConnectionStatus.CONNECTED &&
        b.enabled,
    );
  }

  /**
   * Find broker by URL
   */
  findBrokerByUrl(url: string): ExternalBrokerConnection | undefined {
    for (const [, brokers] of this.connections) {
      const broker = brokers.find((b) => b.connection_url === url);
      if (broker) return broker;
    }
    return undefined;
  }

  /**
   * Update broker status
   */
  updateBrokerStatus(
    brokerConnectionId: string,
    status: ConnectionStatus,
    error?: string,
  ): void {
    for (const [, brokers] of this.connections) {
      const broker = brokers.find((b) => b.id === brokerConnectionId);
      if (broker) {
        broker.connection_status = status;
        if (error) broker.last_error = error;
        if (status === ConnectionStatus.CONNECTED) {
          broker.last_connected_at = new Date();
          broker.connection_attempts = 0;
        } else if (status === ConnectionStatus.ERROR) {
          broker.connection_attempts++;
        }
        broker.updated_at = new Date();
        return;
      }
    }
  }

  /**
   * Record message statistics
   */
  recordMessage(
    brokerConnectionId: string,
    direction: "sent" | "received",
    bytes: number,
  ): void {
    for (const [, brokers] of this.connections) {
      const broker = brokers.find((b) => b.id === brokerConnectionId);
      if (broker) {
        if (direction === "sent") {
          broker.messages_sent++;
          broker.bytes_sent += bytes;
        } else {
          broker.messages_received++;
          broker.bytes_received += bytes;
        }
        return;
      }
    }
  }

  /**
   * Get statistics for an adapter
   */
  getAdapterStats(adapterConfigId: string): {
    total_brokers: number;
    connected_brokers: number;
    total_messages_sent: number;
    total_messages_received: number;
    total_bytes_sent: number;
    total_bytes_received: number;
    brokers: ExternalBrokerConnection[];
  } {
    const brokers = this.connections.get(adapterConfigId) || [];
    const connected = brokers.filter(
      (b) => b.connection_status === ConnectionStatus.CONNECTED,
    );

    return {
      total_brokers: brokers.length,
      connected_brokers: connected.length,
      total_messages_sent: brokers.reduce((sum, b) => sum + b.messages_sent, 0),
      total_messages_received: brokers.reduce(
        (sum, b) => sum + b.messages_received,
        0,
      ),
      total_bytes_sent: brokers.reduce((sum, b) => sum + b.bytes_sent, 0),
      total_bytes_received: brokers.reduce(
        (sum, b) => sum + b.bytes_received,
        0,
      ),
      brokers,
    };
  }
}

/**
 * Example: How MQTT adapter tracks multiple brokers
 *
 * org_adapter_configs table:
 * - id: "mqtt-adapter-org1"
 * - adapter_type: "mqtt"
 * - adapter_vendor: "mosquitto"
 * - config: { // Generic config, doesn't hardcode brokers
 *     "batch_size": 250,
 *     "flush_ms": 50
 *   }
 *
 * external_broker_connections table:
 * - [id: "broker-1", adapter_config_id: "mqtt-adapter-org1",
 *     connection_url: "tcp://broker.org1.com:1883", status: "connected"]
 * - [id: "broker-2", adapter_config_id: "mqtt-adapter-org1",
 *     connection_url: "tcp://broker2.org1.com:1883", status: "connected"]
 * - [id: "broker-3", adapter_config_id: "mqtt-adapter-org1",
 *     connection_url: "tcp://broker3.org1.com:1883", status: "error"]
 *
 * device_routing_rules table:
 * - [device_model: "mqtt-sensor-a", → broker-1]
 * - [device_model: "mqtt-sensor-b", → broker-2]
 * - [device_model: "mqtt-sensor-c", → broker-1 (weighted fallback)]
 */
