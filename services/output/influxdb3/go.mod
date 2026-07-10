module github.com/rogeriocassares/zc8/services/output/influxdb3

go 1.25.5

replace (
	github.com/rogeriocassares/zc8/packages/go-data => ../../../packages/go-data
	github.com/rogeriocassares/zc8/packages/go-infra => ../../../packages/go-infra
	github.com/rogeriocassares/zc8/packages/go-integration => ../../../packages/go-integration
	github.com/rogeriocassares/zc8/packages/go-parser => ../../../packages/go-parser
	github.com/rogeriocassares/zc8/packages/proto => ../../../packages/proto
)
