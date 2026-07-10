module github.com/rogeriocassares/zc8/packages/go-integration

go 1.25.5

require (
	github.com/jackc/pgx/v5 v5.8.0
	github.com/nats-io/nats.go v1.48.0
	github.com/rogeriocassares/zc8/packages/go-data v0.0.0
	github.com/rogeriocassares/zc8/packages/go-infra v0.0.0
	github.com/rogeriocassares/zc8/packages/go-parser v0.0.0
	github.com/rogeriocassares/zc8/packages/proto v0.0.0
)

require (
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/klauspost/compress v1.18.2 // indirect
	github.com/nats-io/nkeys v0.4.11 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	golang.org/x/crypto v0.47.0 // indirect
	golang.org/x/net v0.49.0 // indirect
	golang.org/x/sync v0.19.0 // indirect
	golang.org/x/sys v0.40.0 // indirect
	golang.org/x/text v0.33.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251202230838-ff82c1b0f217 // indirect
	google.golang.org/grpc v1.79.1 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

replace (
	github.com/rogeriocassares/zc8/packages/go-config => ../go-config
	github.com/rogeriocassares/zc8/packages/go-data => ../go-data
	github.com/rogeriocassares/zc8/packages/go-infra => ../go-infra
	github.com/rogeriocassares/zc8/packages/go-parser => ../go-parser
	github.com/rogeriocassares/zc8/packages/proto => ../proto
)
