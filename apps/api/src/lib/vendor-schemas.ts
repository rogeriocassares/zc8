/**
 * Adapter Vendor Schemas
 *
 * Defines configuration schemas for each adapter vendor.
 * Used for:
 * - Form generation on the frontend
 * - Server-side validation
 * - Type-safe configuration handling
 */

import {
  AdapterType,
  AdapterVendor,
  type VendorSchema,
} from "./adapter-types.ts";

export const VENDOR_SCHEMAS: Record<string, VendorSchema> = {
  // ===================================================================
  // MQTT Vendors
  // ===================================================================

  "mqtt/mosquitto": {
    type: AdapterType.MQTT,
    vendor: AdapterVendor.MOSQUITTO,
    description: "Eclipse Mosquitto - Open source MQTT broker",
    properties: {
      broker: {
        type: "string",
        title: "Broker URL",
        description:
          "MQTT broker address (mqtt://host:port or mqtts://host:port)",
        pattern: "^mqtt(s)?://",
        examples: [
          "mqtt://mqtt.example.com:1883",
          "mqtts://ssl-mqtt.example.com:8883",
        ],
      },
      topics: {
        type: "array",
        title: "Topics",
        description: "MQTT topics to subscribe to",
        items: {
          type: "string",
          pattern: "^[a-zA-Z0-9/_+#-]+$",
        },
        examples: [["devices/+/telemetry", "sensors/#"]],
      },
      qos: {
        type: "integer",
        title: "Quality of Service",
        description: "MQTT QoS level",
        enum: [0, 1, 2],
        default: 1,
      },
      username: {
        type: "string",
        title: "Username",
        description: "MQTT broker username (optional)",
      },
      password: {
        type: "string",
        title: "Password",
        description: "MQTT broker password (optional, encrypted in storage)",
        secret: true,
      },
      client_id: {
        type: "string",
        title: "Client ID",
        description: "MQTT client identifier (auto-generated if not provided)",
      },
      keep_alive: {
        type: "integer",
        title: "Keep Alive (seconds)",
        description: "MQTT keep-alive interval",
        default: 60,
        minimum: 10,
      },
    },
    required: ["broker", "topics"],
  },

  "mqtt/activemq": {
    type: AdapterType.MQTT,
    vendor: AdapterVendor.ACTIVEMQ,
    description: "Apache ActiveMQ - Enterprise message broker",
    properties: {
      broker: {
        type: "string",
        title: "Broker URL",
        description: "ActiveMQ address (tcp://host:61616)",
        pattern: "^tcp://",
        examples: ["tcp://activemq.example.com:61616"],
      },
      username: {
        type: "string",
        title: "Username",
        description: "ActiveMQ username",
      },
      password: {
        type: "string",
        title: "Password",
        description: "ActiveMQ password (encrypted in storage)",
        secret: true,
      },
      client_id: {
        type: "string",
        title: "Client ID",
        description: "ActiveMQ client identifier",
      },
      topics: {
        type: "array",
        title: "Topics",
        description: "Topics to subscribe to",
        items: { type: "string" },
      },
    },
    required: ["broker", "username", "password"],
  },

  "mqtt/rabbitmq": {
    type: AdapterType.MQTT,
    vendor: AdapterVendor.RABBITMQ,
    description: "RabbitMQ - Message broker with MQTT plugin",
    properties: {
      broker: {
        type: "string",
        title: "Broker URL",
        description: "RabbitMQ MQTT endpoint (mqtt://host:1883 or amqp://...)",
        examples: ["mqtt://rabbitmq.example.com:1883"],
      },
      username: {
        type: "string",
        title: "Username",
        description: "RabbitMQ username",
      },
      password: {
        type: "string",
        title: "Password",
        description: "RabbitMQ password (encrypted in storage)",
        secret: true,
      },
      vhost: {
        type: "string",
        title: "Virtual Host",
        description: "RabbitMQ virtual host (default: /)",
        default: "/",
      },
      queue: {
        type: "string",
        title: "Queue Name",
        description: "Queue name (optional)",
      },
    },
    required: ["broker", "username", "password"],
  },

  // ===================================================================
  // LNS Vendors
  // ===================================================================

  "lns/chirpstack": {
    type: AdapterType.LNS,
    vendor: AdapterVendor.CHIRPSTACK,
    description: "ChirpStack - Open source LoRaWAN server",
    properties: {
      api_url: {
        type: "string",
        title: "API URL",
        description: "ChirpStack API URL (https://...)",
        pattern: "^https://",
        examples: ["https://chirpstack.example.com"],
      },
      api_token: {
        type: "string",
        title: "API Token",
        description:
          "ChirpStack API authentication token (encrypted in storage)",
        secret: true,
      },
      region: {
        type: "string",
        title: "Region",
        description: "LoRaWAN frequency plan region",
        enum: ["EU868", "US915", "CN780", "IN865", "AU915", "KR920", "AS923"],
        default: "EU868",
      },
      organization_id: {
        type: "string",
        title: "Organization ID",
        description: "ChirpStack organization ID (optional)",
      },
    },
    required: ["api_url", "api_token", "region"],
  },

  "lns/ttn": {
    type: AdapterType.LNS,
    vendor: AdapterVendor.TTN,
    description: "The Things Network - Public LoRaWAN service",
    properties: {
      api_url: {
        type: "string",
        title: "API URL",
        description: "TTN API endpoint",
        enum: [
          "https://eu1.cloud.thethings.network",
          "https://us1.cloud.thethings.network",
        ],
        default: "https://eu1.cloud.thethings.network",
      },
      api_key: {
        type: "string",
        title: "API Key",
        description: "TTN API key (encrypted in storage)",
        secret: true,
      },
      app_id: {
        type: "string",
        title: "Application ID",
        description: "TTN application ID",
      },
      region: {
        type: "string",
        title: "Region",
        description: "Region identifier",
        default: "eu1",
      },
    },
    required: ["api_key", "app_id"],
  },

  "lns/dragino": {
    type: AdapterType.LNS,
    vendor: AdapterVendor.DRAGINO,
    description: "Dragino - IoT gateway and devices",
    properties: {
      api_url: {
        type: "string",
        title: "API URL",
        description: "Dragino gateway API URL",
        examples: ["https://api.dragino.com"],
      },
      api_key: {
        type: "string",
        title: "API Key",
        description: "Dragino API key (encrypted in storage)",
        secret: true,
      },
      device_id: {
        type: "string",
        title: "Device ID",
        description: "Dragino gateway device ID (optional)",
      },
    },
    required: ["api_url", "api_key"],
  },

  // ===================================================================
  // HTTP Vendors
  // ===================================================================

  "http/webhook": {
    type: AdapterType.HTTP,
    vendor: AdapterVendor.HTTP_WEBHOOK,
    description: "HTTP Webhook - Receive device data via HTTP",
    properties: {
      endpoint_path: {
        type: "string",
        title: "Endpoint Path",
        description: "HTTP endpoint path (/webhook/data)",
        pattern: "^/",
      },
      port: {
        type: "integer",
        title: "Port",
        description: "HTTP server port",
        default: 8080,
        minimum: 1024,
        maximum: 65535,
      },
      auth_token: {
        type: "string",
        title: "Auth Token",
        description: "Bearer token for authentication (optional, encrypted)",
        secret: true,
      },
    },
    required: ["endpoint_path"],
  },

  "http/poller": {
    type: AdapterType.HTTP,
    vendor: AdapterVendor.HTTP_POLLER,
    description: "HTTP Poller - Fetch device data via HTTP polling",
    properties: {
      poll_url: {
        type: "string",
        title: "Poll URL",
        description: "HTTP endpoint to poll",
        pattern: "^https?://",
      },
      poll_interval_ms: {
        type: "integer",
        title: "Poll Interval (ms)",
        description: "Polling interval in milliseconds",
        default: 60000,
        minimum: 1000,
      },
      auth_token: {
        type: "string",
        title: "Auth Token",
        description: "Bearer token for HTTP requests (encrypted)",
        secret: true,
      },
      method: {
        type: "string",
        title: "HTTP Method",
        description: "HTTP method to use",
        enum: ["GET", "POST"],
        default: "GET",
      },
      body: {
        type: "object",
        title: "Request Body",
        description: "Request body for POST requests",
      },
    },
    required: ["poll_url"],
  },

  // ===================================================================
  // Agent Vendors
  // ===================================================================

  "agent/cli": {
    type: AdapterType.AGENT,
    vendor: AdapterVendor.AGENT_CLI,
    description: "Agent CLI - Device agent via command line",
    properties: {
      port: {
        type: "integer",
        title: "Port",
        description: "gRPC server port for agents",
        minimum: 1024,
        maximum: 65535,
      },
      host: {
        type: "string",
        title: "Host",
        description: "Server host (0.0.0.0 for all interfaces)",
        default: "0.0.0.0",
      },
      auth_token: {
        type: "string",
        title: "Auth Token",
        description: "Authentication token for agent connections (encrypted)",
        secret: true,
      },
    },
    required: ["port"],
  },

  "agent/ssh": {
    type: AdapterType.AGENT,
    vendor: AdapterVendor.AGENT_SSH,
    description: "Agent SSH - Connect to remote agent via SSH",
    properties: {
      host: {
        type: "string",
        title: "SSH Host",
        description: "SSH server hostname",
      },
      port: {
        type: "integer",
        title: "SSH Port",
        description: "SSH server port",
        default: 22,
      },
      username: {
        type: "string",
        title: "Username",
        description: "SSH username",
      },
      password: {
        type: "string",
        title: "Password",
        description: "SSH password (encrypted)",
        secret: true,
      },
      private_key: {
        type: "string",
        title: "Private Key",
        description: "SSH private key PEM format (encrypted)",
        secret: true,
      },
    },
    required: ["host", "username"],
  },

  // ===================================================================
  // ZC2X Vendors
  // ===================================================================

  "zc2x/direct": {
    type: AdapterType.ZC2X,
    vendor: AdapterVendor.ZC2X_DIRECT,
    description: "ZC2X Direct - Direct serial connection to Zigbee device",
    properties: {
      port: {
        type: "string",
        title: "Serial Port",
        description: "Serial port device (/dev/ttyUSB0, COM3, etc.)",
        examples: ["/dev/ttyUSB0", "COM3"],
      },
      baudrate: {
        type: "integer",
        title: "Baud Rate",
        description: "Serial port baud rate",
        enum: [9600, 19200, 38400, 57600, 115200],
        default: 115200,
      },
      channel: {
        type: "integer",
        title: "Zigbee Channel",
        description: "Zigbee frequency channel (11-26)",
        minimum: 11,
        maximum: 26,
        default: 15,
      },
      pan_id: {
        type: "string",
        title: "PAN ID",
        description: "Personal Area Network ID (hex string, optional)",
      },
    },
    required: ["port"],
  },

  "zc2x/coordinator": {
    type: AdapterType.ZC2X,
    vendor: AdapterVendor.ZC2X_COORDINATOR,
    description: "ZC2X Coordinator - Zigbee coordinator gateway",
    properties: {
      host: {
        type: "string",
        title: "Coordinator Host",
        description: "Zigbee coordinator host/IP",
      },
      port: {
        type: "integer",
        title: "Port",
        description: "Coordinator port",
        default: 5000,
      },
      auth_token: {
        type: "string",
        title: "Auth Token",
        description: "Coordinator authentication token (encrypted)",
        secret: true,
      },
      channel: {
        type: "integer",
        title: "Zigbee Channel",
        description: "Primary Zigbee channel",
        minimum: 11,
        maximum: 26,
        default: 15,
      },
    },
    required: ["host"],
  },
};

export function getVendorSchema(
  type: string,
  vendor: string,
): VendorSchema | null {
  const key = `${type}/${vendor}`;
  return VENDOR_SCHEMAS[key] || null;
}

export function getAllVendorSchemas(): VendorSchema[] {
  return Object.values(VENDOR_SCHEMAS);
}

export function getAllSchemasByType(type: string): VendorSchema[] {
  return Object.values(VENDOR_SCHEMAS).filter((schema) => {
    const key = `${schema.type}/${schema.vendor}`;
    return key.startsWith(type);
  });
}
export function getAllVendorSchemas(): VendorSchema[] {
  return Object.values(VENDOR_SCHEMAS);
}

export function getAllSchemasByType(type: string): VendorSchema[] {
  return Object.values(VENDOR_SCHEMAS).filter((schema) => {
    const key = `${schema.type}/${schema.vendor}`;
    return key.startsWith(type);
  });
}
