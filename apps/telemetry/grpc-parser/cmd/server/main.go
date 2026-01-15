package main

import (
	"log"
	"net"

	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/config"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/grpcserver"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/influxdb3"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/redis"
	pb "github.com/rogeriocassares/zc8/packages/proto/gen/go/telemetry/v1"

	"google.golang.org/grpc"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Initialize Redis
	redisClient := redis.NewClient(&cfg.Redis)
	defer redisClient.Close()

	// initialize Influxdb
	influxdb3Client := influxdb3.NewClient(&cfg.Influxdb3)
	defer influxdb3Client.Close()

	// Create gRPC server
	addr := cfg.Server.Host + ":" + cfg.Server.Port
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}
	s := grpc.NewServer()
	pb.RegisterTelemetryServiceServer(s, grpcserver.New(redisClient, influxdb3Client))

	log.Printf("server listening at %v", lis.Addr())
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
