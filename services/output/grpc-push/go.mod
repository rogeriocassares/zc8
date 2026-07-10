module github.com/rogeriocassares/zc8/services/output/grpc-push

go 1.25.5

replace (
	github.com/rogeriocassares/zc8/packages/go-data => ../../../packages/go-data
	github.com/rogeriocassares/zc8/packages/go-infra => ../../../packages/go-infra
	github.com/rogeriocassares/zc8/packages/go-integration => ../../../packages/go-integration
	github.com/rogeriocassares/zc8/packages/go-parser => ../../../packages/go-parser
	github.com/rogeriocassares/zc8/packages/proto => ../../../packages/proto
)

require google.golang.org/grpc v1.79.1

require (
	golang.org/x/net v0.49.0 // indirect
	golang.org/x/sys v0.40.0 // indirect
	golang.org/x/text v0.33.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251202230838-ff82c1b0f217 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)
