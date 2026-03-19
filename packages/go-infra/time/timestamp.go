package time

import (
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// Now returns the current time as a protobuf Timestamp.
func Now() *timestamppb.Timestamp {
	return timestamppb.Now()
}

// FromTime converts a time.Time to a protobuf Timestamp.
func FromTime(t time.Time) *timestamppb.Timestamp {
	return timestamppb.New(t)
}

// ToTime converts a protobuf Timestamp to time.Time.
func ToTime(ts *timestamppb.Timestamp) time.Time {
	if ts == nil {
		return time.Time{}
	}
	return ts.AsTime()
}

// UnixMillis returns the current time as Unix timestamp in milliseconds.
func UnixMillis() int64 {
	return time.Now().UnixMilli()
}
