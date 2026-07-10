package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/nats-io/nats.go"
)

// HealthServer exposes two HTTP endpoints for infrastructure health checks:
//
//	GET /healthz/live  — liveness: returns 200 while the process is running.
//	GET /healthz/ready — readiness: returns 200 when NATS and the database are
//	                     reachable; 503 when either dependency is down.
//
// Typical usage in a service binary:
//
//	hs := integration.NewHealthServer(":9090", db, nc)
//	hs.Start()
//	defer hs.Shutdown(context.Background())
type HealthServer struct {
	db  *sql.DB
	nc  *nats.Conn
	srv *http.Server
}

// NewHealthServer creates a HealthServer listening on addr (e.g. ":9090").
// db and nc may be nil; their checks are skipped when absent.
func NewHealthServer(addr string, db *sql.DB, nc *nats.Conn) *HealthServer {
	hs := &HealthServer{db: db, nc: nc}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz/live", hs.liveness)
	mux.HandleFunc("/healthz/ready", hs.readiness)

	hs.srv = &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}
	return hs
}

// Start launches the HTTP server in a background goroutine.
// Errors from ListenAndServe (other than http.ErrServerClosed) are silently
// discarded because the health endpoint is best-effort and must not crash the
// service.
func (hs *HealthServer) Start() {
	go func() {
		if err := hs.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			// Non-fatal: log but continue without a health endpoint.
			_ = err
		}
	}()
}

// Shutdown gracefully drains and stops the HTTP server.
func (hs *HealthServer) Shutdown(ctx context.Context) {
	_ = hs.srv.Shutdown(ctx)
}

// liveness always returns 200 — if the process can handle an HTTP request it
// is alive.
func (hs *HealthServer) liveness(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// readiness checks all dependencies and returns 200 only when all are healthy.
func (hs *HealthServer) readiness(w http.ResponseWriter, r *http.Request) {
	checks := map[string]string{}
	ready := true

	// Database ping
	if hs.db != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := hs.db.PingContext(ctx); err != nil {
			checks["database"] = fmt.Sprintf("error: %v", err)
			ready = false
		} else {
			checks["database"] = "ok"
		}
	}

	// NATS connection check
	if hs.nc != nil {
		if !hs.nc.IsConnected() {
			checks["nats"] = "error: not connected"
			ready = false
		} else {
			checks["nats"] = "ok"
		}
	}

	status := "ok"
	if !ready {
		status = "degraded"
	}

	w.Header().Set("Content-Type", "application/json")
	if ready {
		w.WriteHeader(http.StatusOK)
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status": status,
		"checks": checks,
	})
}
