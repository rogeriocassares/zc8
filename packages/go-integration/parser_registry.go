package integration

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"

	"github.com/rogeriocassares/zc8/packages/go-parser"
	"github.com/rogeriocassares/zc8/packages/go-parser/device/agent"
	"github.com/rogeriocassares/zc8/packages/go-parser/device/milesight"
	"github.com/rogeriocassares/zc8/packages/go-parser/device/zc2x"
	"github.com/rogeriocassares/zc8/packages/go-parser/transport/lns"
	"github.com/rogeriocassares/zc8/packages/go-parser/transport/lns/chirpstack"
	"github.com/rogeriocassares/zc8/packages/go-parser/transport/lns/everynet"
)

// ParserRegistry manages loading and retrieving parsers.
// Handles both gateway parsers (extract device payload from transport frame)
// and device parsers (decode device payload into fields).
type ParserRegistry struct {
	db           *sql.DB
	mu           sync.RWMutex
	gatewayCache map[string]parser.GatewayParser
	deviceCache  map[string]parser.DeviceParser
	logger       *log.Logger
}

func NewParserRegistry(db *sql.DB, logger *log.Logger) *ParserRegistry {
	if logger == nil {
		logger = log.New(log.Writer(), "[ParserRegistry] ", log.LstdFlags)
	}
	return &ParserRegistry{
		db:           db,
		gatewayCache: make(map[string]parser.GatewayParser),
		deviceCache:  make(map[string]parser.DeviceParser),
		logger:       logger,
	}
}

// LoadFromDatabase queries service_providers table and instantiates parsers
// based on the provider codes.
func (pr *ParserRegistry) LoadFromDatabase(ctx context.Context) error {
	pr.logger.Printf("Loading parser configurations from database...")

	// Load from service_providers
	query := `
		SELECT id, code
		FROM service_providers
		WHERE is_builtin = true
		ORDER BY code
	`

	rows, err := pr.db.QueryContext(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query service_providers: %w", err)
	}
	defer rows.Close()

	gatewayCount := 0
	deviceCount := 0

	for rows.Next() {
		var id int64
		var code string

		if err := rows.Scan(&id, &code); err != nil {
			pr.logger.Printf("Error scanning provider row: %v", err)
			continue
		}

		// Try to instantiate as gateway parser
		if err := pr.instantiateGatewayParser(code); err == nil {
			gatewayCount++
		}
		// Try to instantiate as device parser
		if err := pr.instantiateDeviceParser(code); err == nil {
			deviceCount++
		}
	}

	// Always load default device parsers
	for _, code := range []string{"agent", "milesight", "zc2x"} {
		if err := pr.instantiateDeviceParser(code); err != nil {
			pr.logger.Printf("Failed to load %s device parser: %v", code, err)
		} else {
			deviceCount++
		}
	}

	if err = rows.Err(); err != nil {
		return fmt.Errorf("error reading provider rows: %w", err)
	}

	pr.logger.Printf("Parser registry loaded: %d gateway, %d device parsers", gatewayCount, deviceCount)
	return nil
}

func (pr *ParserRegistry) instantiateGatewayParser(code string) error {
	pr.mu.RLock()
	_, exists := pr.gatewayCache[code]
	pr.mu.RUnlock()
	if exists {
		return nil
	}

	var p parser.GatewayParser
	switch code {
	case "chirpstack":
		p = chirpstack.NewChirpstackParser()
	case "everynet":
		p = everynet.NewEverynetParser()
	case "lns":
		p = lns.NewLNSParser()
	default:
		return fmt.Errorf("unknown gateway parser: %s", code)
	}
	if p == nil {
		return fmt.Errorf("failed to instantiate gateway parser: %s", code)
	}
	pr.mu.Lock()
	pr.gatewayCache[code] = p
	pr.mu.Unlock()
	return nil
}

func (pr *ParserRegistry) instantiateDeviceParser(code string) error {
	pr.mu.RLock()
	_, exists := pr.deviceCache[code]
	pr.mu.RUnlock()
	if exists {
		return nil
	}

	var p parser.DeviceParser
	switch code {
	case "milesight":
		p = milesight.NewMilesightParser()
	case "zc2x":
		p = zc2x.NewZC2XParser()
	case "agent":
		p = agent.NewAgentParser()
	case "kron", "khomp":
		return fmt.Errorf("parser not yet implemented: %s", code)
	default:
		return fmt.Errorf("unknown device parser: %s", code)
	}
	if p == nil {
		return fmt.Errorf("failed to instantiate device parser: %s", code)
	}
	pr.mu.Lock()
	pr.deviceCache[code] = p
	pr.mu.Unlock()
	return nil
}

// GetGatewayParser returns a gateway parser by code (lazy-load on miss).
func (pr *ParserRegistry) GetGatewayParser(code string) (parser.GatewayParser, error) {
	pr.mu.RLock()
	p, ok := pr.gatewayCache[code]
	pr.mu.RUnlock()
	if ok {
		return p, nil
	}

	if err := pr.instantiateGatewayParser(code); err != nil {
		return nil, fmt.Errorf("gateway parser %q: %w", code, err)
	}

	pr.mu.RLock()
	defer pr.mu.RUnlock()
	return pr.gatewayCache[code], nil
}

// GetDeviceParser returns a device parser by code (lazy-load on miss).
func (pr *ParserRegistry) GetDeviceParser(code string) (parser.DeviceParser, error) {
	pr.mu.RLock()
	p, ok := pr.deviceCache[code]
	pr.mu.RUnlock()
	if ok {
		return p, nil
	}

	if err := pr.instantiateDeviceParser(code); err != nil {
		return nil, fmt.Errorf("device parser %q: %w", code, err)
	}

	pr.mu.RLock()
	defer pr.mu.RUnlock()
	return pr.deviceCache[code], nil
}

// RegisterGatewayParser manually registers a gateway parser.
func (pr *ParserRegistry) RegisterGatewayParser(code string, p parser.GatewayParser) {
	pr.mu.Lock()
	defer pr.mu.Unlock()
	pr.gatewayCache[code] = p
}

// RegisterDeviceParser manually registers a device parser.
func (pr *ParserRegistry) RegisterDeviceParser(code string, p parser.DeviceParser) {
	pr.mu.Lock()
	defer pr.mu.Unlock()
	pr.deviceCache[code] = p
}
