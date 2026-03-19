package gin

import (
	"io"

	"github.com/gin-gonic/gin"
)

// HTTPContext abstracts the HTTP context without exposing gin types
type HTTPContext interface {
	// ReadBody reads the request body
	ReadBody() ([]byte, error)

	// WriteJSON writes a JSON response
	WriteJSON(statusCode int, data interface{})

	// WriteError writes an error response
	WriteError(statusCode int, message string)

	// GetHeader gets a request header
	GetHeader(key string) string

	// GetQuery gets a query parameter
	GetQuery(key string) string

	// GetParam gets a URL parameter
	GetParam(key string) string
}

// contextAdapter adapts gin.Context to HTTPContext interface
type contextAdapter struct {
	c *gin.Context
}

// NewHTTPContext creates a new HTTP context from gin context
func NewHTTPContext(c *gin.Context) HTTPContext {
	return &contextAdapter{c: c}
}

// ReadBody reads and returns the request body
func (ca *contextAdapter) ReadBody() ([]byte, error) {
	defer ca.c.Request.Body.Close()
	return io.ReadAll(ca.c.Request.Body)
}

// WriteJSON writes a JSON response
func (ca *contextAdapter) WriteJSON(statusCode int, data interface{}) {
	ca.c.JSON(statusCode, data)
}

// WriteError writes an error response
func (ca *contextAdapter) WriteError(statusCode int, message string) {
	ca.c.JSON(statusCode, gin.H{
		"error": message,
	})
}

// GetHeader gets a request header
func (ca *contextAdapter) GetHeader(key string) string {
	return ca.c.GetHeader(key)
}

// GetQuery gets a query parameter
func (ca *contextAdapter) GetQuery(key string) string {
	return ca.c.Query(key)
}

// GetParam gets a URL parameter
func (ca *contextAdapter) GetParam(key string) string {
	return ca.c.Param(key)
}

// HTTPHandlerFunc defines a handler function that works with HTTPContext
type HTTPHandlerFunc func(HTTPContext)

// ToGinHandlerFunc converts HTTPHandlerFunc to gin.HandlerFunc
func ToGinHandlerFunc(f HTTPHandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		f(NewHTTPContext(c))
	}
}
