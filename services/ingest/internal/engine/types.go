package engine

import (
	"github.com/rogeriocassares/zc8/packages/go-data"
)

// Re-export data types for backwards compatibility within engine
type (
	Message    = data.Message
	Event      = data.Event
	Field      = data.Field
	Parser     = data.Parser
	ParserID   = data.ParserID
	DeviceMeta = data.DeviceMeta
	DeviceKey  = data.DeviceKey
	Writer     = data.Writer
	Fanout     = data.Fanout
)
