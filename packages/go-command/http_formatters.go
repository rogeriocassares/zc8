package command

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// EverynetHTTPFormatter formats downlink commands for Everynet via HTTP POST.
type EverynetHTTPFormatter struct{}

func (f *EverynetHTTPFormatter) Code() string { return "everynet_http_downlink" }

func (f *EverynetHTTPFormatter) Format(env *pb.CommandEnvelope) (*FormattedCommand, error) {
	url := fmt.Sprintf("%s/downlinks", env.HttpBaseUrl)

	body := map[string]interface{}{
		"dev_eui": env.DevEui,
		"port":    1,
		"payload": base64.StdEncoding.EncodeToString(env.Payload),
	}

	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("everynet: marshal: %w", err)
	}

	return &FormattedCommand{
		Target:  url,
		Payload: data,
		Method:  "POST",
		Headers: map[string]string{"Content-Type": "application/json"},
	}, nil
}

// ActilityHTTPFormatter formats downlink commands for Actility ThingPark via HTTP POST.
type ActilityHTTPFormatter struct{}

func (f *ActilityHTTPFormatter) Code() string { return "actility_http_downlink" }

func (f *ActilityHTTPFormatter) Format(env *pb.CommandEnvelope) (*FormattedCommand, error) {
	url := fmt.Sprintf("%s/api/devices/%s/downlinkMessages", env.HttpBaseUrl, env.DevEui)

	body := map[string]interface{}{
		"payloadHex": fmt.Sprintf("%x", env.Payload),
		"targetPort": 1,
		"confirmed":  false,
	}

	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("actility: marshal: %w", err)
	}

	return &FormattedCommand{
		Target:  url,
		Payload: data,
		Method:  "POST",
		Headers: map[string]string{"Content-Type": "application/json"},
	}, nil
}

// LoriotHTTPFormatter formats downlink commands for LORIOT via HTTP POST.
type LoriotHTTPFormatter struct{}

func (f *LoriotHTTPFormatter) Code() string { return "loriot_http_downlink" }

func (f *LoriotHTTPFormatter) Format(env *pb.CommandEnvelope) (*FormattedCommand, error) {
	url := fmt.Sprintf("%s/1/rest/device/%s/tx", env.HttpBaseUrl, env.DevEui)

	body := map[string]interface{}{
		"cmd":  "tx",
		"EUI":  env.DevEui,
		"port": 1,
		"data": fmt.Sprintf("%x", env.Payload),
	}

	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("loriot: marshal: %w", err)
	}

	return &FormattedCommand{
		Target:  url,
		Payload: data,
		Method:  "POST",
		Headers: map[string]string{"Content-Type": "application/json"},
	}, nil
}

// GenericHTTPFormatter sends command payload as a generic HTTP request.
type GenericHTTPFormatter struct{}

func (f *GenericHTTPFormatter) Code() string { return "generic_http_command" }

func (f *GenericHTTPFormatter) Format(env *pb.CommandEnvelope) (*FormattedCommand, error) {
	url := fmt.Sprintf("%s/devices/%s/commands", env.HttpBaseUrl, env.DeviceKey)

	method := env.HttpMethod
	if method == "" {
		method = "POST"
	}
	contentType := env.HttpContentType
	if contentType == "" {
		contentType = "application/json"
	}

	return &FormattedCommand{
		Target:  url,
		Payload: env.Payload,
		Method:  method,
		Headers: map[string]string{"Content-Type": contentType},
	}, nil
}
