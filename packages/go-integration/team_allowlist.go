package integration

import (
	"context"
	"database/sql"
	"log"
	"sync"
	"time"
)

// TeamKey is a {orgID, teamID} pair used as the allowlist map key.
type TeamKey struct {
	OrgID  int64
	TeamID int64
}

// TeamAllowlist caches the set of (orgID, teamID) pairs whose teams are
// assigned an integration profile that includes this service.
//
// Input adapters use role="input" to drop messages from teams that have not
// assigned this input service.  Output adapters use role="output" to skip
// writing for teams that have not assigned this output service.
//
// The cache is refreshed every interval (same cadence as WorkerManager) via
// a single background goroutine per adapter.  All per-message checks are
// O(1) map lookups with a read-lock — no allocation, no DB round-trips.
type TeamAllowlist struct {
	db        *sql.DB
	serviceID int64
	role      string // "input" or "output"
	logger    *log.Logger

	mu      sync.RWMutex
	allowed map[TeamKey]bool
}

// NewTeamAllowlist creates a TeamAllowlist.  Call Start() to begin background
// refreshes; Load() may be called independently for a one-shot refresh.
func NewTeamAllowlist(db *sql.DB, serviceID int64, role string, logger *log.Logger) *TeamAllowlist {
	if logger == nil {
		logger = log.New(log.Writer(), "[TeamAllowlist] ", log.LstdFlags)
	}
	return &TeamAllowlist{
		db:        db,
		serviceID: serviceID,
		role:      role,
		logger:    logger,
		allowed:   make(map[TeamKey]bool),
	}
}

// Load performs one synchronous reload from the database.
// Called on Start() and every interval tick.
func (a *TeamAllowlist) Load(ctx context.Context) error {
	const query = `
		SELECT t.organization_id, t.id
		FROM teams t
		JOIN integration_profiles ip ON t.integration_profile_id = ip.id
		JOIN integration_profile_services ips ON ips.profile_id = ip.id
		WHERE ips.service_id = $1
		  AND ips.role = $2
		  AND ips.is_active = true
		  AND t.status = 'active'
	`

	rows, err := a.db.QueryContext(ctx, query, a.serviceID, a.role)
	if err != nil {
		return err
	}
	defer rows.Close()

	next := make(map[TeamKey]bool)
	for rows.Next() {
		var k TeamKey
		if err := rows.Scan(&k.OrgID, &k.TeamID); err != nil {
			a.logger.Printf("scan error: %v", err)
			continue
		}
		next[k] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}

	a.mu.Lock()
	a.allowed = next
	a.mu.Unlock()

	a.logger.Printf("loaded %d allowed teams for service %d (role=%s)", len(next), a.serviceID, a.role)
	return nil
}

// Start runs an initial Load then refreshes every interval in the background.
// The background goroutine exits when ctx is cancelled.
func (a *TeamAllowlist) Start(ctx context.Context, interval time.Duration) {
	if err := a.Load(ctx); err != nil {
		a.logger.Printf("initial load error: %v", err)
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := a.Load(ctx); err != nil {
					a.logger.Printf("refresh error: %v", err)
				}
			}
		}
	}()
}

// Contains returns true if the (orgID, teamID) pair is in the allowlist.
// O(1) map lookup — safe to call from multiple goroutines concurrently.
func (a *TeamAllowlist) Contains(orgID, teamID int64) bool {
	a.mu.RLock()
	ok := a.allowed[TeamKey{OrgID: orgID, TeamID: teamID}]
	a.mu.RUnlock()
	return ok
}
