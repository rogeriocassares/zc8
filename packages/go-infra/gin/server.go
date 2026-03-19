package gin

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Server wraps a Gin engine for HTTP serving
type Server struct {
	engine *gin.Engine
	config Config
}

// Config holds HTTP server configuration
type Config struct {
	Host         string
	Port         int
	Mode         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

// DefaultConfig returns default HTTP configuration
func DefaultConfig() Config {
	return Config{
		Host:         "0.0.0.0",
		Port:         8080,
		Mode:         gin.ReleaseMode,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
}

// New creates a new HTTP server with Gin
func New(cfg Config) *Server {
	gin.SetMode(cfg.Mode)
	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.Use(gin.Logger())

	return &Server{
		engine: engine,
		config: cfg,
	}
}

// Engine returns the underlying Gin engine
func (s *Server) Engine() *gin.Engine {
	return s.engine
}

// GET adds a GET route
func (s *Server) GET(path string, handlers ...gin.HandlerFunc) {
	s.engine.GET(path, handlers...)
}

// GetHandler adds a GET route with HTTPHandlerFunc (no gin dependency)
func (s *Server) GetHandler(path string, handler HTTPHandlerFunc) {
	s.engine.GET(path, ToGinHandlerFunc(handler))
}

// POST adds a POST route
func (s *Server) POST(path string, handlers ...gin.HandlerFunc) {
	s.engine.POST(path, handlers...)
}

// PostHandler adds a POST route with HTTPHandlerFunc (no gin dependency)
func (s *Server) PostHandler(path string, handler HTTPHandlerFunc) {
	s.engine.POST(path, ToGinHandlerFunc(handler))
}

// PUT adds a PUT route
func (s *Server) PUT(path string, handlers ...gin.HandlerFunc) {
	s.engine.PUT(path, handlers...)
}

// DELETE adds a DELETE route
func (s *Server) DELETE(path string, handlers ...gin.HandlerFunc) {
	s.engine.DELETE(path, handlers...)
}

// PATCH adds a PATCH route
func (s *Server) PATCH(path string, handlers ...gin.HandlerFunc) {
	s.engine.PATCH(path, handlers...)
}

// Group creates a route group
func (s *Server) Group(path string) *gin.RouterGroup {
	return s.engine.Group(path)
}

// Use adds middleware
func (s *Server) Use(middleware ...gin.HandlerFunc) {
	s.engine.Use(middleware...)
}

// StartSync starts and blocks
func (s *Server) StartSync() error {
	addr := fmt.Sprintf("%s:%d", s.config.Host, s.config.Port)
	fmt.Printf("HTTP server starting on %s\n", addr)
	return s.engine.Run(addr)
}

// Start starts server with context support
func (s *Server) Start(ctx context.Context) error {
	addr := fmt.Sprintf("%s:%d", s.config.Host, s.config.Port)

	server := &http.Server{
		Addr:         addr,
		Handler:      s.engine,
		ReadTimeout:  s.config.ReadTimeout,
		WriteTimeout: s.config.WriteTimeout,
		IdleTimeout:  s.config.IdleTimeout,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("HTTP error: %v\n", err)
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return server.Shutdown(shutdownCtx)
}

// Health responds with health status
func (s *Server) Health(c *gin.Context) {
	c.JSON(200, gin.H{
		"status": "ok",
		"time":   time.Now().Unix(),
	})
}

// SetHealthCheck adds health endpoint
func (s *Server) SetHealthCheck(path string) {
	s.GET(path, s.Health)
}
