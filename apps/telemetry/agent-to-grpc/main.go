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
)

const (
	defaultName = "world"
)

var (
	addr = flag.String("addr", "localhost:50054", "the address to connect to")
	name = flag.String("name", defaultName, "Name to greet")
)

type Output struct {
	Message string `json:"message"`
}

func main() {
	flag.Parse()

	///////////////////////
	1. Ping heartbeat to server (with deviceId)
	2. Pong a command or nil from the server
	3. The command shall have two parameters
	4. When received, it shall ack the server and start the command on pc.
	5. The command output must be sent to the server (with the deviceId) until it finishes
	6/ AT every reply from server, we verify if auth is true.

	Request Message   Response Message
	heartbeat, 
	deviceId,
	logMessage?
	----------------->
                    isAuth?
										newCOmmand?
										s1?
										s2?
										s3?
	                  <-----------------						
                 

	var output Output

	s := strings.Split("ping 8.8.8.8", " ")
	fmt.Printf("\nTopic: %s\n", s[0])
	fmt.Printf("\nMessage: %s\n", s[1])

	cmd := exec.Command(s[0], s[1])
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

	/////////////////////////////////

	// Set up a connection to the server.
	conn, err := grpc.NewClient(*addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("did not connect: %v", err)
	}
	defer conn.Close()
	c := pb.NewTelemetryServiceClient(conn)

	// Contact the server and print out its response.
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	r, err := c.IngestTelemetry(ctx, &pb.IngestTelemetryRequest{DeviceId: *name, Data: []byte("010203")})
	if err != nil {
		log.Fatalf("could not greet: %v", err)
	}
	log.Printf("Greeting: %s", r.GetSuccess())

}
