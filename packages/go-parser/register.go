package parser

// Note: This file previously imported device parsers directly, which created an import cycle.
// Device parsers are now registered by the MQTT adapter from the database.
// Keeping this file for reference but with imports disabled.

/*
import (
	"github.com/rogeriocassares/zc8/packages/go-parser/device/khomp"
	"github.com/rogeriocassares/zc8/packages/go-parser/device/kron"
	"github.com/rogeriocassares/zc8/packages/go-parser/device/milesight"
)

// RegisterAll registers all vendor parsers with the engine registry.
// Services pass their Registry implementation (which satisfies the Registry interface).
func RegisterAll(reg Registry) {
	reg.Register(MilesightID, milesight.NewMilesightParser())
	reg.Register(KronID, kron.NewKronParser())
	reg.Register(KhompID, khomp.NewKhompParser())
}
*/
