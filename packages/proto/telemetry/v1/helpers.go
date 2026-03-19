package v1

import "google.golang.org/protobuf/proto"

// UnmarshalIngestRequest deserializes an IngestRequest from wire format.
// Use this instead of importing google.golang.org/protobuf/proto directly.
func UnmarshalIngestRequest(data []byte) (*IngestRequest, error) {
	var req IngestRequest
	if err := proto.Unmarshal(data, &req); err != nil {
		return nil, err
	}
	return &req, nil
}

// MarshalIngestRequest serializes an IngestRequest to wire format.
// Use this instead of importing google.golang.org/protobuf/proto directly.
func MarshalIngestRequest(req *IngestRequest) ([]byte, error) {
	return proto.Marshal(req)
}
