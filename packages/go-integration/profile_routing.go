package integration

import (
	"context"
	"database/sql"
	"log"
	"sync/atomic"
	"time"
)

// ProfileRoute holds the routing decision for a single device.
// topicTemplate is the value of integration_profile_services.topic_template;
// empty string means "use the adapter's own configured default".
type ProfileRoute struct {
	TopicTemplate string
}

// profileRouteMap is the immutable snapshot held in the atomic pointer.
type profileRouteMap map[uint64]ProfileRoute

// ProfileRoutingTable is a lock-free, in-memory table that maps device_key →
// ProfileRoute for a given service ID.  It is loaded from the DB on Start and
// refreshed periodically in the background.
//
// Build once per output adapter:
//
//	rt := integration.NewProfileRoutingTable(db, serviceID, 60*time.Second, logger)
//	if err := rt.Start(ctx); err != nil { ... }
//	defer rt.Stop()
//
// Per-message lookup (40 ns):
//
//	if route, ok := rt.Lookup(req.DeviceKey); ok { ... }
type ProfileRoutingTable struct {
	db        *sql.DB
	serviceID int64
	interval  time.Duration
	logger    *log.Logger

	ptr    atomic.Pointer[profileRouteMap] // *profileRouteMap
	cancel context.CancelFunc
	done   chan struct{}
}

// NewProfileRoutingTable creates the table but does not start the refresh loop.
// Call Start to perform the initial load and begin background refresh.
func NewProfileRoutingTable(db *sql.DB, serviceID int64, refreshInterval time.Duration, logger *log.Logger) *ProfileRoutingTable {
	if logger == nil {
		logger = log.New(log.Writer(), "[ProfileRoutingTable] ", log.LstdFlags)
	}
	if refreshInterval <= 0 {
		refreshInterval = 60 * time.Second
	}
	return &ProfileRoutingTable{
		db:        db,
		serviceID: serviceID,
		interval:  refreshInterval,
		logger:    logger,
		done:      make(chan struct{}),
	}
}

// Start loads the routing table from the DB and launches a background refresh goroutine.
// The context passed here controls the refresh loop lifetime; Stop() cancels it cleanly.
func (r *ProfileRoutingTable) Start(ctx context.Context) error {
	if err := r.load(ctx); err != nil {
		return err
	}

	rctx, cancel := context.WithCancel(ctx)
	r.cancel = cancel

	go r.refreshLoop(rctx)
	return nil
}

// Stop cancels the background refresh goroutine and waits for it to exit.
func (r *ProfileRoutingTable) Stop() {
	if r.cancel != nil {
		r.cancel()
	}
	<-r.done
}

// Lookup returns (ProfileRoute, true) when device_key is routed through this
// service, or ({}, false) when the message should be skipped.
func (r *ProfileRoutingTable) Lookup(deviceKey uint64) (ProfileRoute, bool) {
	p := r.ptr.Load()
	if p == nil {
		return ProfileRoute{}, false
	}
	route, ok := (*p)[deviceKey]
	return route, ok
}

// Len returns the number of devices currently in the table (for metrics/logging).
func (r *ProfileRoutingTable) Len() int {
	p := r.ptr.Load()
	if p == nil {
		return 0
	}
	return len(*p)
}

// query returns device_key + topic_template for all devices whose applications
// are assigned a profile that includes this service (role='output', is_active).
// A device can appear in multiple applications/profiles; we pick the minimal
// non-empty topic_template (or empty string if all are NULL).
const deviceMapQuery = `
SELECT DISTINCT ON (d.device_key)
  d.device_key,
  COALESCE(ips.topic_template, '') AS topic_template
FROM devices d
JOIN application_devices ad  ON ad.device_id            = d.id
JOIN applications app        ON app.id                  = ad.application_id
JOIN integration_profile_services ips
                             ON ips.profile_id           = app.integration_profile_id
WHERE ips.service_id  = $1
  AND ips.role        = 'output'
  AND ips.is_active   = true
  AND d.is_active     = true
ORDER BY d.device_key, ips.topic_template NULLS LAST
`

func (r *ProfileRoutingTable) load(ctx context.Context) error {
	rows, err := r.db.QueryContext(ctx, deviceMapQuery, r.serviceID)
	if err != nil {
		return err
	}
	defer rows.Close()

	m := make(profileRouteMap)
	for rows.Next() {
		var (
			deviceKey     uint64
			topicTemplate string
		)
		if err := rows.Scan(&deviceKey, &topicTemplate); err != nil {
			return err
		}
		m[deviceKey] = ProfileRoute{TopicTemplate: topicTemplate}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	r.ptr.Store(&m)
	r.logger.Printf("routing table loaded: %d devices for service_id=%d", len(m), r.serviceID)
	return nil
}

func (r *ProfileRoutingTable) refreshLoop(ctx context.Context) {
	defer close(r.done)
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.load(ctx); err != nil && ctx.Err() == nil {
				r.logger.Printf("routing table refresh error: %v", err)
			}
		}
	}
}
