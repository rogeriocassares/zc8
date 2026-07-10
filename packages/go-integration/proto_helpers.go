package integration

import (
	"fmt"
	"strconv"
	"time"

	data "github.com/rogeriocassares/zc8/packages/go-data"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// MessageToRawEnvelope converts a unified Message into an IngestEnvelope with
// a RawPayload — published to data.{orgId}.{teamId}.{deviceKey}.raw for audit.
func MessageToRawEnvelope(msg *Message, rawBytes []byte, sourceTopic string) *pb.IngestEnvelope {
	deviceKey, ctx := resolveContext(msg)
	return &pb.IngestEnvelope{
		EventId:   generateEventID(msg),
		Ts:        timestamppb.New(msg.ReceivedAt),
		IngestTs:  timestamppb.Now(),
		Source:    pb.IngestSource_SOURCE_MQTT,
		Type:      pb.PayloadType_PAYLOAD_RAW,
		DeviceKey: deviceKey,
		Context:   ctx,
		Payload: &pb.IngestEnvelope_Raw{
			Raw: &pb.RawPayload{
				Data:        rawBytes,
				SourceTopic: sourceTopic,
				ServiceId:   msg.ServiceID,
			},
		},
	}
}

// MessageToDecodedEnvelope converts a unified Message into an IngestEnvelope
// with a DecodedPayload — published to data.{orgId}.{teamId}.{deviceKey}.decoded
// and consumed by all output services (InfluxDB3, MQTT, HTTP, gRPC, ClickHouse).
func MessageToDecodedEnvelope(msg *Message) *pb.IngestEnvelope {
	deviceKey, ctx := resolveContext(msg)

	decoded := &pb.DecodedPayload{
		Measurement: "sensor_data",
		OrgId:       strconv.FormatInt(msg.OrganizationID, 10),
		TeamId:      strconv.FormatInt(msg.TeamID, 10),
		DeviceKey:   msg.DeviceKey,
		ModelCode:   msg.DeviceModelCode,
		VendorId:    strconv.FormatInt(msg.VendorID, 10),
		ServiceId:   msg.ServiceID,
	}

	// Attach location + asset tags from device context
	if ctx != nil && ctx.Tags != nil {
		decoded.Latitude = ctx.Tags.Latitude
		decoded.Longitude = ctx.Tags.Longitude
		decoded.AltitudeM = ctx.Tags.AltitudeM
		decoded.LocationName = ctx.Tags.LocationName
		decoded.AssetId = ctx.Tags.AssetId
		decoded.Category = ctx.Tags.Category
		if len(ctx.Tags.Extra) > 0 {
			decoded.ExtraTags = ctx.Tags.Extra
		}
	}

	// Build a map of sensor_type → calibration for O(1) lookup
	calibMap := make(map[string]*pb.SensorCalibration, len(ctx.GetCalibrations()))
	for _, c := range ctx.GetCalibrations() {
		calibMap[c.SensorType] = c
	}

	// Convert DeviceData values to SensorField entries
	if msg.DeviceData != nil {
		for sensorType, val := range msg.DeviceData.Values {
			field := &pb.SensorField{
				SensorType: sensorType,
				Scale:      1.0,
				Offset:     0.0,
			}

			// Apply calibration if available
			if cal, ok := calibMap[sensorType]; ok {
				field.Scale = cal.Scale
				field.Offset = cal.Offset
				field.Unit = cal.Unit
			}

			switch v := val.(type) {
			case float64:
				field.ValueType = pb.ValueType_VALUE_FLOAT
				field.ValueFloat = v
				field.CalibratedValue = v*field.Scale + field.Offset
			case int:
				field.ValueType = pb.ValueType_VALUE_INT
				field.ValueInt = int64(v)
				field.CalibratedValue = float64(v)*field.Scale + field.Offset
			case int64:
				field.ValueType = pb.ValueType_VALUE_INT
				field.ValueInt = v
				field.CalibratedValue = float64(v)*field.Scale + field.Offset
			case bool:
				field.ValueType = pb.ValueType_VALUE_BOOL
				field.ValueBool = v
				if v {
					field.CalibratedValue = 1.0*field.Scale + field.Offset
				}
			default:
				continue
			}

			decoded.Fields = append(decoded.Fields, field)
		}
	}

	return &pb.IngestEnvelope{
		EventId:   generateEventID(msg),
		Ts:        timestamppb.New(msg.ReceivedAt),
		IngestTs:  timestamppb.Now(),
		Source:    pb.IngestSource_SOURCE_MQTT,
		Type:      pb.PayloadType_PAYLOAD_DECODED,
		DeviceKey: deviceKey,
		Context:   ctx,
		Payload: &pb.IngestEnvelope_Decoded{
			Decoded: decoded,
		},
	}
}

func resolveContext(msg *Message) (uint64, *pb.DeviceContext) {
	var deviceKey uint64
	if msg.DeviceUUID != "" {
		dk, err := data.ParseUUIDv7ToDeviceKey(msg.DeviceUUID)
		if err == nil {
			deviceKey = uint64(dk)
		}
	}
	ctx := &pb.DeviceContext{
		DeviceKey:       deviceKey,
		OrganizationId:  msg.OrganizationID,
		TeamId:          msg.TeamID,
		DeviceId:        msg.DeviceUUID,
		DeviceModelCode: msg.DeviceModelCode,
		VendorId:        msg.VendorID,
		// Tags and Calibrations are populated by DeviceLookup (extended) or adapter
		Tags:         msg.DeviceTags,
		Calibrations: msg.Calibrations,
	}
	return deviceKey, ctx
}

func generateEventID(msg *Message) string {
	return fmt.Sprintf("%s-%d-%s-%d", msg.ServiceType, msg.ServiceID, msg.DeviceKey, time.Now().UnixNano())
}
