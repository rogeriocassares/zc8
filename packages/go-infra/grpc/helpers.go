package grpc

import (
	"fmt"
	"time"
)

// RetryConfig configures retry behavior
type RetryConfig struct {
	MaxAttempts      int
	InitialBackoffMs int
	MaxBackoffMs     int
}

// DefaultRetryConfig returns sensible retry defaults
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts:      3,
		InitialBackoffMs: 100,
		MaxBackoffMs:     5000,
	}
}

// CalculateBackoff calculates exponential backoff duration
func (r RetryConfig) CalculateBackoff(attempt int) time.Duration {
	backoff := r.InitialBackoffMs * (1 << uint(attempt))
	if backoff > r.MaxBackoffMs {
		backoff = r.MaxBackoffMs
	}
	return time.Duration(backoff) * time.Millisecond
}

// ConnectionStats provides metrics about streaming connection
type ConnectionStats struct {
	StartTime      time.Time
	SendCount      uint64
	RecvCount      uint64
	ErrorCount     uint64
	ReconnectCount uint64
	TotalDuration  time.Duration
	IsConnected    bool
}

// Uptime returns how long the connection has been active
func (cs *ConnectionStats) Uptime() time.Duration {
	if cs.StartTime.IsZero() {
		return 0
	}
	return time.Since(cs.StartTime)
}

// ErrorRate calculates the error percentage
func (cs *ConnectionStats) ErrorRate() float64 {
	total := cs.SendCount + cs.ErrorCount
	if total == 0 {
		return 0
	}
	return float64(cs.ErrorCount) / float64(total) * 100
}

// String provides a human-readable summary
func (cs *ConnectionStats) String() string {
	return fmt.Sprintf(
		"ConnectionStats{uptime=%v, sent=%d, recv=%d, errors=%d, reconnects=%d, errorRate=%.2f%%, connected=%v}",
		cs.Uptime(), cs.SendCount, cs.RecvCount, cs.ErrorCount,
		cs.ReconnectCount, cs.ErrorRate(), cs.IsConnected,
	)
}
