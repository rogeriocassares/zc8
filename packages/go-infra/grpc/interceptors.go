package grpc

import (
	"context"
	"log"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// UnaryClientInterceptor creates a unary client interceptor for logging and retry
func UnaryClientInterceptor(logger *log.Logger, maxRetries int) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply interface{},
		cc *grpc.ClientConn, invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption) error {

		start := time.Now()
		var lastErr error

		for attempt := 0; attempt <= maxRetries; attempt++ {
			if attempt > 0 {
				logger.Printf("[gRPC] Retry attempt %d for %s", attempt, method)
				time.Sleep(time.Duration(attempt*100) * time.Millisecond)
			}

			lastErr = invoker(ctx, method, req, reply, cc, opts...)
			if lastErr == nil {
				logger.Printf("[gRPC] %s completed in %v", method, time.Since(start))
				return nil
			}

			if !isRetryable(lastErr) {
				break
			}
		}

		return lastErr
	}
}

// StreamClientInterceptor creates a stream client interceptor for logging
func StreamClientInterceptor(logger *log.Logger) grpc.StreamClientInterceptor {
	return func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn,
		method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {

		logger.Printf("[gRPC] Stream started: %s", method)
		stream, err := streamer(ctx, desc, cc, method, opts...)
		if err != nil {
			logger.Printf("[gRPC] Stream error: %s - %v", method, err)
			return nil, err
		}

		return stream, nil
	}
}

// UnaryServerInterceptor creates a unary server interceptor for logging and recovery
func UnaryServerInterceptor(logger *log.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler) (interface{}, error) {

		start := time.Now()

		defer func() {
			if r := recover(); r != nil {
				logger.Printf("[gRPC Server] Panic in %s: %v", info.FullMethod, r)
			}
		}()

		resp, err := handler(ctx, req)

		if err != nil {
			logger.Printf("[gRPC Server] Error in %s: %v (duration: %v)",
				info.FullMethod, err, time.Since(start))
		} else {
			logger.Printf("[gRPC Server] %s completed in %v",
				info.FullMethod, time.Since(start))
		}

		return resp, err
	}
}

// StreamServerInterceptor creates a stream server interceptor for logging
func StreamServerInterceptor(logger *log.Logger) grpc.StreamServerInterceptor {
	return func(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo,
		handler grpc.StreamHandler) error {

		logger.Printf("[gRPC Server] Stream started: %s", info.FullMethod)

		err := handler(srv, ss)

		if err != nil {
			logger.Printf("[gRPC Server] Stream error in %s: %v",
				info.FullMethod, err)
		} else {
			logger.Printf("[gRPC Server] Stream completed: %s", info.FullMethod)
		}

		return err
	}
}

// isRetryable checks if an error is eligible for retry
func isRetryable(err error) bool {
	if err == nil {
		return false
	}

	st, ok := status.FromError(err)
	if !ok {
		return false
	}

	switch st.Code() {
	case codes.Unavailable, codes.ResourceExhausted, codes.DeadlineExceeded:
		return true
	default:
		return false
	}
}
