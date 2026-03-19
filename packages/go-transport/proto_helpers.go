package transport

import (
	"fmt"
	"time"

	"github.com/rogeriocassares/zc8/packages/go-data"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// MessageToProto converts a unified Message into a proto IngestRequest
// ready for submission via IngestClient.
func MessageToProto(msg *Message) *pb.IngestRequest {
	var preParsedFields []*pb.ParsedField
	if msg.DeviceData != nil {
		for key, val := range msg.DeviceData.Values {
			var f float64
			switch v := val.(type) {
			case float64:
				f = v
			case int:
				f = float64(v)
			case int64:
				f = float64(v)
			case bool:
				if v {
					f = 1
				}
			default:
				continue
			}
			preParsedFields = append(preParsedFields, &pb.ParsedField{Key: key, Value: f})
		}
	}

	var deviceKey uint64
	if msg.DeviceUUID != "" {
		dk, err := data.ParseUUIDv7ToDeviceKey(msg.DeviceUUID)
		if err == nil {
			deviceKey = uint64(dk)
		}
	}

	dc := &pb.DeviceContext{
		DeviceKey:       deviceKey,
		OrganizationId:  msg.OrganizationID,
		TeamId:          msg.TeamID,
		DeviceModelCode: msg.DeviceModelCode,
		VendorId:        msg.VendorID,
	}

	if r := msg.Routing; r != nil {
		dc.IngestRouting = &pb.IngestRouting{
			InfluxdbConfigId:    r.InfluxDBConfigID,
			WriteToInfluxdb:     r.WriteToInfluxDB,
			RequireInfluxdbAck:  r.RequireInfluxDBAck,
			InfluxdbHost:        r.InfluxDBHost,
			InfluxdbToken:       r.InfluxDBToken,
			InfluxdbBucket:      r.InfluxDBBucket,
			InfluxdbMeasurement: r.InfluxDBMeasurement,
			RedisConfigId:       r.RedisConfigID,
			WriteToRedis:        r.WriteToRedis,
			RedisMaxHashEntries: r.RedisMaxHashEntries,
			RedisHost:           r.RedisHost,
			RedisKeyPrefix:      r.RedisKeyPrefix,
			NatsConfigId:        r.NATSConfigID,
			WriteToNats:         r.WriteToNATS,
			NatsUrl:             r.NATSURL,
			NatsSubjectPrefix:   r.NATSSubjectPrefix,
		}
	}

	return &pb.IngestRequest{
		EventId:         fmt.Sprintf("%s-%d-%s-%d", msg.TransportType, msg.TransportRegistryID, msg.DeviceKey, time.Now().UnixNano()),
		DeviceKey:       deviceKey,
		PreParsedFields: preParsedFields,
		DeviceContext:   dc,
	}
}
