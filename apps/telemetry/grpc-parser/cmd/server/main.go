package main

import (
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

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
	// Initialize clients
	// postgresClient := postgres.NewClient(&cfg.Postgres)
	// defer postgres.Close(postgresClient)

	// Initialize Redis
	redisClient := redis.NewClient(&cfg.Redis)
	defer redisClient.Close()

	// initialize Influxdb
	influxdb3Client := influxdb3.NewClient(&cfg.Influxdb3)
	defer influxdb3Client.Close()

	// Create gRPC server
	addr := cfg.GrpcServer.BindAdress + ":" + cfg.GrpcServer.Port
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}
	s := grpc.NewServer()
	// pb.RegisterTelemetryServiceServer(s, grpcserver.NewServer(redisClient, postgresClient, influxdb3Client))
	pb.RegisterTelemetryServiceServer(s, grpcserver.NewServer(redisClient, influxdb3Client))

	log.Printf("server listening at %v", lis.Addr())
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down gracefully...")
}
