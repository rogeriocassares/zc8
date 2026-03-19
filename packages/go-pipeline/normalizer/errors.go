package normalizer

import "errors"

var (
	// ErrDuplicate is returned when a duplicate message is detected
	ErrDuplicate = errors.New("duplicate message detected")
)
