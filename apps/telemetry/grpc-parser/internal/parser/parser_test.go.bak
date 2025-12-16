package parser

import (
	"encoding/json"
	"testing"
)

func TestParseJSON(t *testing.T) {
	p := New()

	payload := []byte(`{"temperature": 25.5, "humidity": 60}`)
	config := ParseConfig{Type: "json"}

	result, err := p.Parse(payload, config)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}

	if result["temperature"] != 25.5 {
		t.Errorf("Expected temperature 25.5, got %v", result["temperature"])
	}
}

func TestParseBinary(t *testing.T) {
	p := New()

	// Binary data: [0x00, 0x01, 0x03, 0xE8] = device_id: 1, temp: 1000
	payload := []byte{0x00, 0x01, 0x03, 0xE8}

	schema := BinarySchema{
		Fields: []BinaryField{
			{Name: "device_id", Type: "uint16", Endian: "big"},
			{Name: "temperature", Type: "uint16", Endian: "big", Scale: 0.01},
		},
	}
	schemaJSON, _ := json.Marshal(schema)

	config := ParseConfig{Type: "binary", Schema: schemaJSON}

	result, err := p.Parse(payload, config)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}

	if result["device_id"] != float64(1) {
		t.Errorf("Expected device_id 1, got %v", result["device_id"])
	}

	if result["temperature"] != float64(10) { // 1000 * 0.01 = 10
		t.Errorf("Expected temperature 10, got %v", result["temperature"])
	}
}
