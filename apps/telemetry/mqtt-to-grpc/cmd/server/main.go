package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	MQTT "github.com/eclipse/paho.mqtt.golang"
	"github.com/google/uuid"
	"github.com/rogeriocassares/zc8/apps/telemetry/mqtt-to-grpc/internal/config"
	pb "github.com/rogeriocassares/zc8/packages/proto/gen/go/telemetry/v1"
	"github.com/samborkent/uuidv7"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	channelBufferSize = 100
	numGrpcWorkers    = 5
	grpcTimeout       = 5 * time.Second
	maxRetries        = 3
)

type MQTTMessage struct {
	Topic   string
	Payload []byte
}

// type GrpcClient struct {
// 	conn   *grpc.ClientConn
// 	client pb.TelemetryServiceClient
// 	mu     sync.Mutex
// }

type GrpcClient struct {
	conn   *grpc.ClientConn
	client pb.TelemetryIngestServiceClient

	stream pb.TelemetryIngestService_IngestStreamClient
	ctx    context.Context
	cancel context.CancelFunc

	mu sync.Mutex
}

func uuidv7New() string {
	return uuidv7.New().String()
}

func unixNano() *timestamppb.Timestamp {
	return timestamppb.Now()
}

func (g *GrpcClient) ensureStreamLocked() error {
	if g.stream != nil {
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())

	stream, err := g.client.IngestStream(ctx)
	if err != nil {
		cancel()
		return err
	}

	g.ctx = ctx
	g.cancel = cancel
	g.stream = stream
	return nil
}

func (g *GrpcClient) ensureStream() error {
	if g.stream != nil {
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())

	stream, err := g.client.IngestStream(ctx)
	if err != nil {
		cancel()
		return err
	}

	g.ctx = ctx
	g.cancel = cancel
	g.stream = stream
	return nil
}

func mqttConnLostHandler(c MQTT.Client, err error) {
	log.Printf("MQTT Connection lost, reason: %v. Attempting to reconnect...\n", err)
}

func main() {
	// Load configuration
	cfg := config.Load()

	flag.Parse()
	ctx, cancel := context.WithCancel(context.Background())
	// ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Init unique gRPC (reusable)
	// Create gRPC server
	addr := cfg.GrpcServer.Host + ":" + cfg.GrpcServer.Port
	grpcClient, err := initGrpcClient(addr)
	if err != nil {
		log.Fatalf("Failed to initialize gRPC client: %v", err)
	}
	defer grpcClient.Close()

	mqttChan := make(chan *pb.IngestRequest, channelBufferSize)

	mqttClient := initMQTTClient(mqttChan)
	defer mqttClient.Disconnect(250)

	// Wait Group to Manage GoRoutines
	var wg sync.WaitGroup

	// Goroutine 1: MQTT Subscriber (callback)
	log.Println("MQTT Subscriber initialized and listening...")

	// Goroutines 2-N: Worker pool to send via gRPC
	for i := 0; i < numGrpcWorkers; i++ {
		wg.Add(1)
		go grpcWorker(ctx, &wg, i, mqttChan, grpcClient)
	}
	log.Println("All workers started. System is running. Press CTRL+C to stop.")

	<-sigChan
	log.Println("Shutdown signal received, closing gracefully...")
	cancel()

	close(mqttChan)
	wg.Wait()

	log.Println("All workers finished. Exiting.")
}

func initGrpcClient(addr string) (*GrpcClient, error) {
	// Configure keep-alive for persistent connection
	kaParams := keepalive.ClientParameters{
		Time:                10 * time.Second,
		Timeout:             3 * time.Second,
		PermitWithoutStream: true,
	}

	conn, err := grpc.NewClient(
		addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithKeepaliveParams(kaParams),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to gRPC server: %w", err)
	}

	client := pb.NewTelemetryIngestServiceClient(conn)
	log.Printf("Connected to gRPC server at %s\n", addr)

	return &GrpcClient{
		conn:   conn,
		client: client,
	}, nil
}

func initMQTTClient(mqttChan chan<- *pb.IngestRequest) MQTT.Client {
	id := uuid.New().String()
	mqttBroker := "tcp://mqtt.maua.br:1883"

	clientID := fmt.Sprintf("parse-lns-sub-%s", id)
	topic := "device/+/telemetry"

	opts := MQTT.NewClientOptions()
	opts.AddBroker(mqttBroker)
	opts.SetClientID(clientID)
	opts.SetUsername("public")
	opts.SetPassword("public")
	opts.SetAutoReconnect(true)
	opts.SetConnectionLostHandler(mqttConnLostHandler)
	opts.SetOnConnectHandler(func(c MQTT.Client) {
		log.Println("MQTT Connected successfully")
		// Re-subscribe on reconnect
		if token := c.Subscribe(topic, 0, nil); token.Wait() && token.Error() != nil {
			log.Printf("Failed to subscribe: %v", token.Error())
		}
	})

	// Message handler sends messages to channel
	opts.SetDefaultPublishHandler(func(client MQTT.Client, msg MQTT.Message) {
		mqttMsg := parseMQTTMessage(msg.Topic(), msg.Payload())
		select {
		case mqttChan <- mqttMsg:
			// Successfully sent to channel
		default:
			log.Printf("Warning: Channel full, dropping message from topic %s", msg.Topic())
		}
	})

	client := MQTT.NewClient(opts)
	if token := client.Connect(); token.Wait() && token.Error() != nil {
		log.Fatalf("Failed to connect to MQTT broker: %v", token.Error())
	}

	if token := client.Subscribe(topic, 0, nil); token.Wait() && token.Error() != nil {
		log.Fatalf("Failed to subscribe to topic: %v", token.Error())
	}

	log.Printf("Subscribed to MQTT topic: %s", topic)
	return client
}

func parseMQTTMessage(topic string, payload []byte) *pb.IngestRequest {
	parts := strings.Split(topic, "/")
	var deviceId string
	if len(parts) > 1 {
		deviceId = parts[1]
	}
	itr := &pb.IngestRequest{
		EventId:   uuidv7New(),
		DeviceId:  deviceId,
		Payload:   payload,
		Timestamp: unixNano(),
		Source:    pb.IngestSource_SOURCE_MQTT,
	}
	return itr
}

func grpcWorker(ctx context.Context, wg *sync.WaitGroup, workerID int, mqttChan <-chan *pb.IngestRequest, grpcClient *GrpcClient) {
	defer wg.Done()
	log.Printf("gRPC Worker %d started and waiting for messages...", workerID)

	for {
		select {
		case <-ctx.Done():
			log.Printf("gRPC Worker %d shutting down (context cancelled)", workerID)
			return
		case msg, ok := <-mqttChan:
			if !ok {
				log.Printf("gRPC Worker %d: channel closed, exiting", workerID)
				return
			}
			log.Printf("gRPC Worker %d: received message from deviceId %s", workerID, msg.DeviceId)
			processMessage(ctx, workerID, msg, grpcClient)
		}
	}
}

func processMessage(ctx context.Context, workerID int, msg *pb.IngestRequest, grpcClient *GrpcClient) {
	// Retry logic
	var err error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		// err = sendToGrpc(ctx, msg, grpcClient)
		err = sendToGrpcClient(msg, grpcClient)
		if err != nil {
			log.Printf("gRPC send failed: %v", err)
		}

		// err = sendToGrpcStream(msg, grpcClient)
		if err == nil {
			log.Printf("Worker %d: Successfully sent message from %s", workerID, msg.DeviceId)
			return
		}

		if attempt < maxRetries {
			log.Printf("Worker %d: Attempt %d failed, retrying... Error: %v", workerID, attempt, err)
			time.Sleep(time.Duration(attempt) * time.Second) // Exponential backoff
		}
	}

	log.Printf("Worker %d: Failed to send message after %d attempts. DeviceId: %s, Error: %v",
		workerID, maxRetries, msg.DeviceId, err)
}

func (g *GrpcClient) Close() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	var err error

	if g.stream != nil {
		_, err = g.stream.CloseAndRecv()
		g.cancel()
		g.stream = nil
	}

	if g.conn != nil {
		if cerr := g.conn.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}

	return err
}

func sendToGrpcClient(
	msg *pb.IngestRequest,
	g *GrpcClient,
) error {

	g.mu.Lock()
	defer g.mu.Unlock()

	if err := g.ensureStreamLocked(); err != nil {
		return fmt.Errorf("stream init failed: %w", err)
	}

	if err := g.stream.Send(msg); err != nil {
		// stream broken → reset and retry once
		g.cancel()
		g.stream = nil

		if err := g.ensureStreamLocked(); err != nil {
			return fmt.Errorf("stream recreate failed: %w", err)
		}

		if err := g.stream.Send(msg); err != nil {
			return fmt.Errorf("stream send failed: %w", err)
		}
	}

	return nil
}

// func sendToGrpc(ctx context.Context, msg *pb.IngestRequest, grpcClient *GrpcClient) error {
// 	grpcCtx, cancel := context.WithTimeout(ctx, grpcTimeout)
// 	defer cancel()

// 	// Thread-safe access to gRPC client
// 	grpcClient.mu.Lock()
// 	client := grpcClient.client
// 	grpcClient.mu.Unlock()

// 	stream, err := grpcClient.client.IngestTelemetry(ctx)
// 	if err != nil {
// 		log.Fatal(err)
// 	}

// 	// response, err := client.IngestTelemetry(grpcCtx, &pb.IngestRequest{
// 	// 	DeviceId: msg.DeviceId,
// 	// 	Data:     msg.Data,
// 	// })

// 	if err != nil {
// 		return fmt.Errorf("gRPC call failed: %w", err)
// 	}

// 	log.Printf("gRPC Response: %v", response.GetSuccess())
// 	return nil
// }
