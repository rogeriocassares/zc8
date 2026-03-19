package grpc

import "google.golang.org/grpc"

// NewServer creates a new gRPC server with the provided options.
// This wraps google.golang.org/grpc.NewServer so that services do not need
// to import the grpc package directly.
func NewServer(opts ...grpc.ServerOption) *grpc.Server {
	return grpc.NewServer(opts...)
}
