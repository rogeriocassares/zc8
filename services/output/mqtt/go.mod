module github.com/rogeriocassares/zc8/services/output/mqtt

go 1.25.5

replace (
	github.com/rogeriocassares/zc8/packages/go-data => ../../../packages/go-data
	github.com/rogeriocassares/zc8/packages/go-infra => ../../../packages/go-infra
	github.com/rogeriocassares/zc8/packages/go-integration => ../../../packages/go-integration
	github.com/rogeriocassares/zc8/packages/go-parser => ../../../packages/go-parser
	github.com/rogeriocassares/zc8/packages/proto => ../../../packages/proto
)

require github.com/eclipse/paho.mqtt.golang v1.5.1

require (
	github.com/gorilla/websocket v1.5.3 // indirect
	golang.org/x/net v0.49.0 // indirect
	golang.org/x/sync v0.19.0 // indirect
)
