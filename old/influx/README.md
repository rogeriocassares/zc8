infra/influx

1. client.go
   type Client
   func New(ctx, cfg) -> influxdb3.New()
   func Client()
   func Health()
   func Close()

2. manager.go
   type Manager
   func NewManager(ctx, client, workers, batchSize, flushSeconds) -> NewWriter(...)
   func Write(ctx, model) -> model.Database() -> writer.Dispatch(...)
   func Shutdown(ctx)

3. writer.go
   func NewWriter(ctx, client, database, workers, batchSize, flushSeconds) -> newWorker(...)
   func Dispatch(ctx, model)
   func Shutdown(ctx, model)
   func shard (key, n)

4. worker.go
   type Worker
   func newWorker(ctx, client, database, batchSize, flushSeconds) -> run(...)
   func enqueue(ctx, model)
   func run(ctx) -> append from queue
   func flush(ctx, batch) -> LineProtocol() -> w.client.Client().Write(...)
   func shutdown()

influx_writer.go
type InfluxWriter
func NewInfluxWriter (url, token, org, bucket)
func Write(events) -> influxdb3.NewPoint(...) -> w.client.WritePOints

Read [](file:///Users/rogeriocassares/Git/rogeriocassares/zc8/services/ingest/internal/infra)

Searched for files matching `**/services/ingest/**/{manager,writer,worker}.go`, 3 matches

Read [](file:///Users/rogeriocassares/Git/rogeriocassares/zc8/services/ingest/internal/infra/influx/manager.go)

Read [](file:///Users/rogeriocassares/Git/rogeriocassares/zc8/services/ingest/internal/infra/influx/writer.go)

Read [](file:///Users/rogeriocassares/Git/rogeriocassares/zc8/services/ingest/internal/infra/influx/worker.go)

Here are the key differences between these three files in the InfluxDB infrastructure layer:

## **Manager.go** (High-level Coordinator)

- **Purpose**: Routes incoming write requests to the appropriate database handler
- **Responsibility**: Maintains a map of Writers (one per database)
- **Role**: Acts as a facade that receives write models and dispatches them to the correct Writer based on the model's database
- **Shutdown**: Coordinates shutdown of all Writers

## **Writer.go** (Load Distributor)

- **Purpose**: Manages multiple workers and distributes writes across them for a single database
- **Responsibility**:
  - Creates and manages a pool of workers (configurable count)
  - Uses consistent hashing (FNV hash algorithm) to shard writes based on device key
  - Ensures that writes from the same device always go to the same worker (maintaining order)
- **Role**: Balances load across workers using the `shard()` function

## **Worker.go** (Actual Data Writer)

- **Purpose**: The lowest-level component that actually performs writes to InfluxDB
- **Responsibility**:
  - Maintains a queue for incoming write models
  - Batches writes together (up to batchSize or flushInterval)
  - Runs in its own goroutine to continuously process the queue
  - Uses a buffer pool (`sync.Pool`) for memory efficiency
  - Flushes batches to InfluxDB when size threshold is reached or time interval expires
  - Handles write timeouts and cleanup

## **Architecture Summary**

```
Manager (routes by database)
  └─> Writer per database (shards by device key)
       └─> Multiple workers (actually write to InfluxDB)
```

This is a hierarchical pipeline: **Manager** → **Writers** → **Workers**, with each level handling a different concern (routing, sharding, and batching/writing).
