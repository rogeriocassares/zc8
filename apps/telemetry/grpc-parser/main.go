package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"time"

	pb "github.com/rogeriocassares/zc8/packages/proto/gen/go/telemetry/v1"

	"google.golang.org/grpc"
)

var (
	port = flag.Int("port", 50054, "The server port")
)

// type Input struct {
// 	Tags   InputTags
// 	Fields InputFields
// }

type Output struct {
	Name      string                 `json:"name"`
	Fields    map[string]interface{} `json:"fields"`
	Tags      map[string]interface{} `json:"tags"`
	Timestamp uint64                 `json:"timestamp"`
}

// server is used to implement helloworld.GreeterServer.
type server struct {
	pb.UnimplementedGreeterServer
}

func mapToCommaString(m map[string]interface{}) string {
	var sb strings.Builder
	for k, v := range m {
		sb.WriteString(",")
		sb.WriteString(k)
		sb.WriteString("=")
		switch v.(type) {
		case string:
			if k == "data" {
				sb.WriteString(`"`)
				sb.WriteString(v.(string))
				sb.WriteString(`"`)
			} else {
				sb.WriteString(v.(string))
			}
		case float64:
			sb.WriteString(strconv.FormatFloat(v.(float64), 'f', -1, 64))
		case uint64:
			sb.WriteString(strconv.FormatUint(v.(uint64), 10))
		}

	}
	return strings.Replace(sb.String(), ",", "", 1)
}

func marshalToJson(msg Output) string {
	outputMsgJson, _ := json.Marshal(msg)
	// if err != nil {
	// 	fmt.Println(err.Error())
	// }
	return string(outputMsgJson[:])
}

func marshalToInflux(msg Output) string {
	var sb strings.Builder
	sb.WriteString(msg.Name)
	sb.WriteString(",")
	sb.WriteString(mapToCommaString(msg.Tags))
	sb.WriteString(" ")
	sb.WriteString(mapToCommaString(msg.Fields))
	sb.WriteString(" ")
	sb.WriteString(strconv.FormatUint(uint64(msg.Timestamp), 10))

	return string(sb.String())
}

func b64ToByte(b64 string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		log.Fatal(err)
	}
	return b, err
}

// B64 to Byte
// b, err := b64ToByte(canData)
// if err != nil {
// 	// fmt.Print(data)
// 	log.Panic(err)
// }

func mergeKeysAndValues(keys1, keys2 map[string]interface{}) map[string]interface{} {
	merged := make(map[string]interface{})
	for k, v := range keys1 {
		merged[k] = v
	}
	for k, v := range keys2 {
		merged[k] = v
	}
	return merged
}

func parse(deviceId, payload string) Output {
	var tags map[string]interface{}
	var output Output
	log.Printf("parse(): %v", payload)

	// READ FROM REDIS HERE WHAT IS IMPORTANT TO PARSE THE PAYLOAD: "deviceModel"
	// deviceId: 019b08df-26e7-7506-a5f6-916b2bef24f4, deviceModel: ks3000, measurement: instant, deviceSerial: 491028
	// deviceId: 019b08df-26e7-71b5-8df6-56c2e954ac91, deviceModel: ks3000, measurement: instant, deviceSerial: 2515111
	// deviceId: 019b08df-26e7-7119-97da-523f9236db80, deviceModel: ks3000, measurement: instant, deviceSerial: 2515112
	// deviceId: 019b08df-26e7-7f7b-a18f-b3d6c3fdf248, deviceModel: ks3000, measurement: instant, deviceSerial: 2515113
	// deviceId: 019b08df-26e7-7866-a0fb-1768122b8584, deviceModel: ks3000, measurement: instant, deviceSerial: 2515114

	deviceModel := "ks3000"

	switch deviceModel {
	// unstrucrured payloads

	// Kron
	case "ks3000":
		// Identify the payload by keys
		// [{"variable": "data","time":"2025-12-10 21:24:08","metadata":{"U0":215.32,"I0":1.28,"F1":60.02,"P0":476.53,"Q0":-15.86,"S0":476.80,"FP0":1.00,"CE":0}}]
		if "variable" == "data" {
			// TODO: Analyze metadata fields. If contains U0, I0, F1, P0, Q0, S0, FP0, CE then it's from ks3000 instant measurment table in influxdb
		}

	// structured payloads

	// AspectMidia
	case "am19_smartlight":
	case "am19_counter":
	case "am19_milkfat":
	// Milesight
	case "em410_rdl":
	case "em103":
	case "ct310":

		// Khomp

		// SagaMedicao

	}

	// Marshal InputMsg.Data interface{} to Json string represented in bytes
	// inputMsgData, _ := json.Marshal(input.Fields.Data)

	// comment
	//inputMsgData := input.Fields.Data

	// fmt.Printf("inputMsgData: ", inputMsgData)

	// if message == "" {
	// 	return "No message to parse"
	// }

	// comment
	// if input.Tags.Direction == "up" {
	// 	tags = map[string]interface{}{
	// 		"deviceType": input.Tags.DeviceType,
	// 		"deviceId":   input.Tags.DeviceId,
	// 		"direction":  input.Tags.Direction,
	// 		"origin":     input.Tags.Etc,
	// 	}

	// 	switch input.Tags.DeviceType {
	// 	case "Car":
	// 		switch input.Tags.Measurement {

	// 		case "Can":
	// 			s := strings.Split(inputMsgData, ",")
	// 			canId := s[0]
	// 			canData := s[1]

	// 			// B64 to Byte
	// 			b, err := b64ToByte(canData)
	// 			if err != nil {
	// 				// fmt.Print(data)
	// 				log.Panic(err)
	// 			}

	// 			var carCanData CarCanData
	// 			d := protocolParserCanDataByCanId(canId, b)
	// 			json.Unmarshal([]byte(d), &carCanData)

	// 			var sbCanData strings.Builder
	// 			sbCanData.WriteString(`"`)
	// 			sbCanData.WriteString(canData)
	// 			sbCanData.WriteString(`"`)

	// 			if canId == "5" {
	// 				var carCan5 CarCan5
	// 				carCan5.GroundSpeed = carCanData.GroundSpeed
	// 				carCan5.Gear = carCanData.Gear
	// 				carCan5.ThrottlePosition = carCanData.ThrottlePosition
	// 				carCan5.BrakePressureFront = carCanData.BrakePressureFront

	// 				tags := map[string]interface{}{
	// 					"deviceType": input.Tags.DeviceType,
	// 					"canId":      canId,
	// 					"message":    "CarCan5",
	// 				}
	// 				fields := map[string]interface{}{
	// 					// "data":        sbCanData.String(),
	// 					"data":               canData,
	// 					"groundSpeed":        carCan5.GroundSpeed,
	// 					"gear":               carCan5.Gear,
	// 					"throttlePosition":   carCan5.ThrottlePosition,
	// 					"brakePressureFront": carCan5.BrakePressureFront,
	// 				}
	// 				output.Tags = tags
	// 				output.Fields = fields
	// 			}

	// 		}
	// 	}
	// }

	// fmt.Printf("\n@@@@@@inputTags %v", input.Tags)
	// fmt.Printf("\n@@@@@@inputFields: %v", input.Fields)
	// fmt.Printf("\n@@@@@@inputMsgData: %v", inputMsgData)
	// fmt.Printf("\n")

	fmt.Printf("\n")
	fmt.Printf("\n+++++++++parsedTags: %v", output.Tags)
	fmt.Printf("\n+++++++++parsedFields: %v", output.Fields)

	mergedTags := mergeKeysAndValues(tags, output.Tags)

	// Timestamp_ns
	now := time.Now()      // current local time
	nsec := now.UnixNano() // number of nanoseconds since January 1, 1970 UTC

	// output.Name = input.Tags.Measurement
	output.Tags = mergedTags
	// output.Fields = parsedFields
	output.Timestamp = uint64(nsec)

	return output
}

// SendMessageToServer implements helloworld.GreeterServer
func (s *server) SendMessageToServer(_ context.Context, in *pb.HelloRequest) (*pb.HelloReply, error) {
	// log.Printf("Received: %v", in.GetPayload())

	output := parse(in.GetDeviceId(), in.GetPayload())
	log.Printf("\n=======>output: %v", output)

	// outputJson := marshalToJson(output)
	// outputInflux := marshalToInflux(output)
	// log.Printf("\noutputJson: %v", outputJson)
	// log.Printf("\noutputInflux: %v", outputInflux)

	return &pb.HelloReply{Message: "Hello " + in.GetOrganization()}, nil
}

func main() {
	flag.Parse()
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", *port))
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}
	s := grpc.NewServer()
	pb.RegisterGreeterServer(s, &server{})
	log.Printf("server listening at %v", lis.Addr())
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
