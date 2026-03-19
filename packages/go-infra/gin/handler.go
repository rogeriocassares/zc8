package gin

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler provides common handler functions
type Handler struct{}

// NewHandler creates a new handler
func NewHandler() *Handler {
	return &Handler{}
}

// BindJSON binds JSON request body
func (h *Handler) BindJSON(c *gin.Context, v interface{}) error {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	defer c.Request.Body.Close()

	return json.Unmarshal(body, v)
}

// ResponseJSON writes JSON response
func (h *Handler) ResponseJSON(c *gin.Context, statusCode int, data interface{}) {
	c.JSON(statusCode, data)
}

// ResponseSuccess writes success response
func (h *Handler) ResponseSuccess(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// ResponseError writes error response
func (h *Handler) ResponseError(c *gin.Context, statusCode int, message string) {
	c.JSON(statusCode, gin.H{
		"success": false,
		"error":   message,
	})
}

// ResponseCreated writes 201 response
func (h *Handler) ResponseCreated(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data":    data,
	})
}

// Middleware utilities
type Middleware struct{}

// NewMiddleware creates middleware instance
func NewMiddleware() *Middleware {
	return &Middleware{}
}

// CORS returns CORS middleware
func (m *Middleware) CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// Auth returns authentication middleware
func (m *Middleware) Auth(validateToken func(string) error) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("Authorization")
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			c.Abort()
			return
		}

		if err := validateToken(token); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			c.Abort()
			return
		}

		c.Next()
	}
}

// ErrorHandler returns error handler
func (m *Middleware) ErrorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if len(c.Errors) > 0 {
			err := c.Errors.Last()
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": err.Error(),
			})
		}
	}
}
