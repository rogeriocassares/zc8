package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"

	pb "github.com/rogeriocassares/zc8/packages/proto/gen/go/telemetry/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"os"
	"os/signal"
	"sync"
	"syscall"

	// "github.com/google/uuid"

	"google.golang.org/grpc/keepalive"
)

// func main() {
// 	flag.Parse()

// 	///////////////////////
// 	// 1. Ping heartbeat to server (with deviceId)
// 	// 2. Pong a command or nil from the server
// 	// 3. The command shall have two parameters
// 	// 4. When received, it shall ack the server and start the command on pc.
// 	// 5. The command output must be sent to the server (with the deviceId) until it finishes
// 	// 6/ AT every reply from server, we verify if auth is true.

// 	// Request Message   Response Message
// 	// heartbeat,
// 	// deviceId,
// 	// logMessage?
// 	// ----------------->
// 	//                   isAuth?
// 	// 									newCOmmand?
// 	// 									s1?
// 	// 									s2?
// 	// 									s3?
// 	//                   <-----------------
// 	///////////////////////

// 	/////////////////////////////////

// }

// package main

const (
	defaultName       = "world"
	channelBufferSize = 100
	numGrpcWorkers    = 5
	grpcTimeout       = 5 * time.Second
	maxRetries        = 3
)

var (
	addr = flag.String("addr", "localhost:50054", "the address to connect to")
	name = flag.String("name", defaultName, "Name to greet")
)

type MQTTMessage struct {
	Topic   string
	Payload []byte
}

type Output struct {
	Message string `json:"message"`
}
type GrpcClient struct {
	conn   *grpc.ClientConn
	client pb.TelemetryServiceClient
	mu     sync.Mutex
}

func main() {
	flag.Parse()
	ctx, cancel := context.WithCancel(context.Background())
	// ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Init unique gRPC (reusable)
	grpcClient, err := initGrpcClient(*addr)
	if err != nil {
		log.Fatalf("Failed to initialize gRPC client: %v", err)
	}
	defer grpcClient.Close()

	mqttChan := make(chan *pb.IngestTelemetryRequest, channelBufferSize)

	go initPingCommand(mqttChan)
	// defer mqttClient.Disconnect(250)

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

	client := pb.NewTelemetryServiceClient(conn)
	log.Printf("Connected to gRPC server at %s\n", addr)

	return &GrpcClient{
		conn:   conn,
		client: client,
	}, nil
}

func (gc *GrpcClient) Close() {
	if gc.conn != nil {
		gc.conn.Close()
	}
}

func initPingCommand(mqttChan chan<- *pb.IngestTelemetryRequest) {
	var output Output

	cmd := exec.Command("ping", "8.8.8.8")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatal("Failed to get stdout pipe:", err)
	}

	if err := cmd.Start(); err != nil {
		log.Fatal("Failed to start command:", err)
	}

	// Read stdout in real time
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var sbMqttPubText strings.Builder
		sbMqttPubText.WriteString(">")
		sbMqttPubText.WriteString(scanner.Text())
		fmt.Printf("\n%s", sbMqttPubText.String())
		output.Message = scanner.Text()

		// 		Performance Tips:
		// Only do this when necessary (e.g., before sending over a network).
		// For very large logs, consider writing directly to a StreamWriter with UTF-8 encoding instead of using StringBuilder at all.
		telemetryRequest := &pb.IngestTelemetryRequest{
			DeviceId: "019b76c4-d38a-7eba-9036-3586652112a4",
			Data:     []byte(sbMqttPubText.String()),
		}

		select {
		case mqttChan <- telemetryRequest:
			// Successfully sent to channel
		default:
			log.Printf("Warning: Channel full, dropping message")
		}
	}

	// Check for scanning errors
	if err := scanner.Err(); err != nil {
		log.Println("Error reading output:", err)
	}

	// This is crucial: Wait for the command to finish
	if err := cmd.Wait(); err != nil {
		log.Fatal("Command failed:", err)
	}

	fmt.Println("Command finished successfully.")
}

func parseMQTTMessage(topic string, payload []byte) *pb.IngestTelemetryRequest {
	parts := strings.Split(topic, "/")
	var deviceId string
	if len(parts) > 1 {
		deviceId = parts[1]
	}
	itr := &pb.IngestTelemetryRequest{
		DeviceId: deviceId,
		Data:     payload,
	}
	return itr
}

func grpcWorker(ctx context.Context, wg *sync.WaitGroup, workerID int, mqttChan <-chan *pb.IngestTelemetryRequest, grpcClient *GrpcClient) {
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

func processMessage(ctx context.Context, workerID int, msg *pb.IngestTelemetryRequest, grpcClient *GrpcClient) {
	// Retry logic
	var err error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err = sendToGrpc(ctx, msg, grpcClient)
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

func sendToGrpc(ctx context.Context, msg *pb.IngestTelemetryRequest, grpcClient *GrpcClient) error {
	grpcCtx, cancel := context.WithTimeout(ctx, grpcTimeout)
	defer cancel()

	// Thread-safe access to gRPC client
	grpcClient.mu.Lock()
	client := grpcClient.client
	grpcClient.mu.Unlock()

	response, err := client.IngestTelemetry(grpcCtx, &pb.IngestTelemetryRequest{
		DeviceId: msg.DeviceId,
		Data:     msg.Data,
	})

	if err != nil {
		return fmt.Errorf("gRPC call failed: %w", err)
	}

	log.Printf("gRPC Response: %v", response.GetSuccess())
	return nil
}
