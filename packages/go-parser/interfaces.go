package parser

// DeviceData is the output from a device parser.
// It contains decoded values from the manufacturer-specific payload.
type DeviceData struct {
	// Decoded values (manufacturer-specific)
	Values    map[string]interface{} // temperature, humidity, power, etc.
	Metadata  map[string]string      // Additional metadata
	Raw       []byte                 // Original payload for reference
	Timestamp int64                  // Millisecond timestamp
}

// DeviceParser parses manufacturer-specific device payloads.
// Input: Raw bytes from the device (typically encrypted or binary format)
// Output: DeviceData with decoded values
type DeviceParser interface {
	// Parse decodes the device payload into structured values
	Parse(payload []byte) (*DeviceData, error)

	// Name returns the parser name (e.g., "milesight", "kron", "agent")
	Name() string
}
