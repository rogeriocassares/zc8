package processor

import (
	"fmt"
	"log"

	"github.com/rogeriocassares/zc8/packages/go-data"
)

// JSONHandler processes JSON payloads with adapter-specific logic
type JSONHandler interface {
	ProcessJSON(payload []byte, deviceID string) (*data.NormalizedMessage, error)
}

// PayloadProcessor orchestrates payload processing with parser registry and JSON handling
type PayloadProcessor struct {
	logger      *log.Logger
	registry    *ParserRegistry
	jsonHandler JSONHandler
}

// ParserRegistry manages vendor-specific payload parsers
type ParserRegistry struct {
	parsers map[data.ParserID]data.Parser
}

// NewParserRegistry creates a new parser registry
func NewParserRegistry() *ParserRegistry {
	return &ParserRegistry{
		parsers: make(map[data.ParserID]data.Parser),
	}
}

// NewPayloadProcessor creates a new processor with specified JSON handler
func NewPayloadProcessor(logger *log.Logger, handler JSONHandler) *PayloadProcessor {
	return &PayloadProcessor{
		logger:      logger,
		registry:    NewParserRegistry(),
		jsonHandler: handler,
	}
}

// ProcessJSONPayload processes a JSON payload by delegating to the registered handler
func (p *PayloadProcessor) ProcessJSONPayload(payload []byte, deviceID string) (*data.NormalizedMessage, error) {
	return p.jsonHandler.ProcessJSON(payload, deviceID)
}

// ProcessBinaryPayload processes a binary payload using the parser registry
func (p *PayloadProcessor) ProcessBinaryPayload(payload []byte, deviceID string, parserID data.ParserID) (*data.NormalizedMessage, error) {
	parser, ok := p.registry.GetParser(parserID)
	if !ok {
		return nil, fmt.Errorf("parser not found for ID %d", parserID)
	}

	msg := data.NewNormalizedMessage(deviceID, "device")

	// Parse binary payload into fields
	var fields []data.Field
	parser.Parse(payload, &fields)

	// Convert fields to normalized message
	for _, f := range fields {
		msg.SetField(f.Key, f.Value)
	}

	return msg, nil
}

// ToFields converts NormalizedMessage fields to a key-value map.
// Callers should build SensorField proto messages from this map directly.
func (p *PayloadProcessor) ToFields(msg *data.NormalizedMessage) map[string]float64 {
	out := make(map[string]float64, len(msg.Fields))
	for key, value := range msg.Fields {
		out[key] = value
	}
	return out
}

// RegisterParser registers a parser for a specific ID
func (p *PayloadProcessor) RegisterParser(parserID data.ParserID, parser data.Parser) {
	p.registry.RegisterParser(parserID, parser)
}

// GetParser retrieves a parser by ID
func (p *PayloadProcessor) GetParser(parserID data.ParserID) (data.Parser, bool) {
	return p.registry.GetParser(parserID)
}

// RegisterParser on ParserRegistry
func (r *ParserRegistry) RegisterParser(id data.ParserID, parser data.Parser) {
	r.parsers[id] = parser
}

// GetParser retrieves a parser from the registry
func (r *ParserRegistry) GetParser(id data.ParserID) (data.Parser, bool) {
	parser, ok := r.parsers[id]
	return parser, ok
}
