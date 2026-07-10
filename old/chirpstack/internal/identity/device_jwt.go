package identity

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// DeviceJWTClaims represents the JWT payload for device authentication
type DeviceJWTClaims struct {
	// Device identifier (UUIDv7)
	DeviceID string `json:"device_id"`

	// Tenant/Organization identifier
	TenantID int64 `json:"tenant_id"`

	// Device key (human-readable identifier)
	DeviceKey string `json:"device_key"`

	// Device permissions/scopes
	Scopes []string `json:"scopes"`

	// Standard JWT claims
	IssuedAt  int64 `json:"iat"`
	ExpiresAt int64 `json:"exp"`

	// Metadata
	Purpose string `json:"purpose"` // "telemetry", "command", "status", etc.
}

// DeviceJWTHeader represents the JWT header
type DeviceJWTHeader struct {
	Algorithm string `json:"alg"`
	Type      string `json:"typ"`
	KeyID     string `json:"kid,omitempty"` // Key ID for key rotation
}

// DeviceJWTBuilder creates and validates device JWT tokens
type DeviceJWTBuilder struct {
	signingKey []byte // HMAC-SHA256 signing key
	issuer     string
}

// NewDeviceJWTBuilder creates a new JWT builder with signing key
func NewDeviceJWTBuilder(signingKey []byte, issuer string) *DeviceJWTBuilder {
	return &DeviceJWTBuilder{
		signingKey: signingKey,
		issuer:     issuer,
	}
}

// BuildToken creates a signed JWT token for a device
func (b *DeviceJWTBuilder) BuildToken(claims *DeviceJWTClaims) (string, error) {
	// Set default values
	if claims.IssuedAt == 0 {
		claims.IssuedAt = time.Now().Unix()
	}
	if claims.ExpiresAt == 0 {
		claims.ExpiresAt = time.Now().Add(24 * time.Hour).Unix() // Default 24 hours
	}
	if len(claims.Scopes) == 0 {
		claims.Scopes = []string{"read:telemetry", "write:telemetry"}
	}
	if claims.Purpose == "" {
		claims.Purpose = "telemetry"
	}

	// Create header
	header := DeviceJWTHeader{
		Algorithm: "HS256",
		Type:      "JWT",
	}

	// Encode header
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", fmt.Errorf("failed to marshal header: %w", err)
	}
	headerB64 := base64.RawURLEncoding.EncodeToString(headerJSON)

	// Encode claims
	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("failed to marshal claims: %w", err)
	}
	claimsB64 := base64.RawURLEncoding.EncodeToString(claimsJSON)

	// Create signature
	message := fmt.Sprintf("%s.%s", headerB64, claimsB64)
	signature := b.sign(message)
	signatureB64 := base64.RawURLEncoding.EncodeToString(signature)

	// Return complete token
	token := fmt.Sprintf("%s.%s.%s", headerB64, claimsB64, signatureB64)
	return token, nil
}

// ValidateToken validates a JWT token and returns the claims
func (b *DeviceJWTBuilder) ValidateToken(token string) (*DeviceJWTClaims, error) {
	// Split token
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}

	headerB64, claimsB64, signatureB64 := parts[0], parts[1], parts[2]

	// Verify signature
	expectedSignature := b.sign(fmt.Sprintf("%s.%s", headerB64, claimsB64))
	expectedB64 := base64.RawURLEncoding.EncodeToString(expectedSignature)

	if !hmac.Equal([]byte(signatureB64), []byte(expectedB64)) {
		return nil, fmt.Errorf("invalid signature")
	}

	// Decode header
	headerData, err := base64.RawURLEncoding.DecodeString(headerB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode header: %w", err)
	}

	var header DeviceJWTHeader
	if err := json.Unmarshal(headerData, &header); err != nil {
		return nil, fmt.Errorf("failed to unmarshal header: %w", err)
	}

	if header.Algorithm != "HS256" {
		return nil, fmt.Errorf("unsupported algorithm: %s", header.Algorithm)
	}

	// Decode claims
	claimsData, err := base64.RawURLEncoding.DecodeString(claimsB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode claims: %w", err)
	}

	var claims DeviceJWTClaims
	if err := json.Unmarshal(claimsData, &claims); err != nil {
		return nil, fmt.Errorf("failed to unmarshal claims: %w", err)
	}

	// Verify expiry
	if claims.ExpiresAt < time.Now().Unix() {
		return nil, fmt.Errorf("token expired")
	}

	// Verify issued at time (shouldn't be in the future)
	if claims.IssuedAt > time.Now().Unix() {
		return nil, fmt.Errorf("token issued in the future")
	}

	return &claims, nil
}

// ExtractDeviceIDFromToken extracts device ID without validating signature
// Useful for routing before full validation
func (b *DeviceJWTBuilder) ExtractDeviceIDFromToken(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid token format")
	}

	claimsData, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("failed to decode claims: %w", err)
	}

	var claims DeviceJWTClaims
	if err := json.Unmarshal(claimsData, &claims); err != nil {
		return "", fmt.Errorf("failed to unmarshal claims: %w", err)
	}

	return claims.DeviceID, nil
}

// HasScope checks if token has required scope
func (b *DeviceJWTBuilder) HasScope(token string, requiredScope string) (bool, error) {
	claims, err := b.ValidateToken(token)
	if err != nil {
		return false, err
	}

	for _, scope := range claims.Scopes {
		if scope == requiredScope || scope == "*" {
			return true, nil
		}
	}
	return false, nil
}

// sign computes HMAC-SHA256
func (b *DeviceJWTBuilder) sign(message string) []byte {
	h := hmac.New(sha256.New, b.signingKey)
	h.Write([]byte(message))
	return h.Sum(nil)
}

// GenerateDeviceKey creates a unique device key for the token signing
// Format: device_{uuid}_{rand} to support device key rotation
func GenerateDeviceKey(deviceID string) string {
	// Could be enhanced with random suffix for key rotation
	return fmt.Sprintf("device_%s", deviceID[:8])
}
