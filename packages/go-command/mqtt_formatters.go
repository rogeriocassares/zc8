package command

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// ChirpStackMQTTFormatter formats downlink commands for ChirpStack via MQTT.
// Topic: application/{application_id}/device/{dev_eui}/command/down
// Payload: {"devEui": "...", "confirmed": false, "fPort": 1, "data": "<base64>"}
type ChirpStackMQTTFormatter struct{}

func (f *ChirpStackMQTTFormatter) Code() string { return "chirpstack_mqtt_downlink" }

func (f *ChirpStackMQTTFormatter) Format(env *pb.CommandEnvelope) (*FormattedCommand, error) {
	appID := metadataString(env, "application_id")
	if appID == "" {
		appID = "1" // default application
	}
	devEUI := env.DevEui
	if devEUI == "" {
		return nil, fmt.Errorf("chirpstack: dev_eui is required")
	}

	topic := fmt.Sprintf("application/%s/device/%s/command/down", appID, devEUI)

	downlink := map[string]interface{}{
		"devEui":    devEUI,
		"confirmed": false,
		"fPort":     1,
		"data":      base64.StdEncoding.EncodeToString(env.Payload),
	}

	data, err := json.Marshal(downlink)
	if err != nil {
		return nil, fmt.Errorf("chirpstack: marshal: %w", err)
	}

	return &FormattedCommand{Target: topic, Payload: data}, nil
}

// TTNMQTTFormatter formats downlink commands for The Things Network via MQTT.
// Topic: v3/{application_id}@{tenant_id}/devices/{device_id}/down/push
type TTNMQTTFormatter struct{}

func (f *TTNMQTTFormatter) Code() string { return "ttn_mqtt_downlink" }

func (f *TTNMQTTFormatter) Format(env *pb.CommandEnvelope) (*FormattedCommand, error) {
	appID := metadataString(env, "application_id")
	if appID == "" {
		return nil, fmt.Errorf("ttn: application_id required in device_metadata")
	}
	tenantID := metadataString(env, "tenant_id")
	if tenantID == "" {
		tenantID = "ttn"
	}

	topic := fmt.Sprintf("v3/%s@%s/devices/%s/down/push", appID, tenantID, env.DeviceId)

	downlink := map[string]interface{}{
		"downlinks": []map[string]interface{}{
			{
				"f_port":      1,
				"frm_payload": base64.StdEncoding.EncodeToString(env.Payload),
				"confirmed":   false,
			},
		},
	}

	data, err := json.Marshal(downlink)
	if err != nil {
		return nil, fmt.Errorf("ttn: marshal: %w", err)
	}

	return &FormattedCommand{Target: topic, Payload: data}, nil
}

// DirectMQTTFormatter publishes raw payload to a configurable MQTT topic.
// Topic comes from device_metadata.command_topic or defaults to devices/{device_key}/command.
type DirectMQTTFormatter struct{}

func (f *DirectMQTTFormatter) Code() string { return "direct_mqtt_command" }

func (f *DirectMQTTFormatter) Format(env *pb.CommandEnvelope) (*FormattedCommand, error) {
	topic := metadataString(env, "command_topic")
	if topic == "" {
		topic = fmt.Sprintf("devices/%s/command", env.DeviceKey)
	}

	return &FormattedCommand{Target: topic, Payload: env.Payload}, nil
}
