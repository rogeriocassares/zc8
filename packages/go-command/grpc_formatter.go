package command

import (
	"fmt"

	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// GRPCBidirectionalFormatter prepares command data for gRPC bidirectional streaming.
// The Target is the gRPC service address; Payload is the raw command bytes.
type GRPCBidirectionalFormatter struct{}

func (f *GRPCBidirectionalFormatter) Code() string { return "grpc_bidirectional" }

func (f *GRPCBidirectionalFormatter) Format(env *pb.CommandEnvelope) (*FormattedCommand, error) {
	if env.GrpcHost == "" {
		return nil, fmt.Errorf("grpc: host is required")
	}

	target := fmt.Sprintf("%s:%d", env.GrpcHost, env.GrpcPort)

	return &FormattedCommand{
		Target:  target,
		Payload: env.Payload,
	}, nil
}
