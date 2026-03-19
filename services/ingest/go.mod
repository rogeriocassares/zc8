module github.com/rogeriocassares/zc8/services/ingest

go 1.25.5

require (
	github.com/rogeriocassares/zc8/packages/go-data v0.0.0
	github.com/rogeriocassares/zc8/packages/go-infra v0.0.0
	github.com/rogeriocassares/zc8/packages/proto v0.0.0
)

replace (
	github.com/rogeriocassares/zc8/packages/go-cache => ../../packages/go-cache
	github.com/rogeriocassares/zc8/packages/go-data => ../../packages/go-data
	github.com/rogeriocassares/zc8/packages/go-infra => ../../packages/go-infra
	github.com/rogeriocassares/zc8/packages/go-parser => ../../packages/go-parser
	github.com/rogeriocassares/zc8/packages/proto => ../../packages/proto
)

require (
	github.com/InfluxCommunity/influxdb3-go/v2 v2.13.0 // indirect
	github.com/apache/arrow-go/v18 v18.5.1 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/goccy/go-json v0.10.5 // indirect
	github.com/google/flatbuffers v25.12.19+incompatible // indirect
	github.com/influxdata/line-protocol/v2 v2.2.1 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/klauspost/compress v1.18.2 // indirect
	github.com/klauspost/cpuid/v2 v2.3.0 // indirect
	github.com/nats-io/nats.go v1.48.0 // indirect
	github.com/nats-io/nkeys v0.4.11 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/pierrec/lz4/v4 v4.1.23 // indirect
	github.com/redis/go-redis/v9 v9.18.0 // indirect
	github.com/zeebo/xxh3 v1.0.2 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	golang.org/x/crypto v0.47.0 // indirect
	golang.org/x/exp v0.0.0-20250408133849-7e4ce0ab07d0 // indirect
	golang.org/x/mod v0.32.0 // indirect
	golang.org/x/telemetry v0.0.0-20260109210033-bd525da824e2 // indirect
	golang.org/x/tools v0.41.0 // indirect
	golang.org/x/xerrors v0.0.0-20240903120638-7835f813f4da // indirect
)

require (
	github.com/jackc/pgx/v5 v5.8.0 // indirect
	golang.org/x/net v0.49.0 // indirect
	golang.org/x/sync v0.19.0 // indirect
	golang.org/x/sys v0.40.0 // indirect
	golang.org/x/text v0.33.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251202230838-ff82c1b0f217 // indirect
	google.golang.org/grpc v1.79.1 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)
