package engine

import "runtime"

type Engine struct {
	shards []*Shard
	mask   uint64
	count  uint64
}

func NewEngine(
	reg *ParserRegistry,
	writer Writer,
	fanout Fanout, // REFACTORED: Now required for multi-destination fanout
) *Engine {

	n := nextPowerOfTwo(uint64(runtime.NumCPU()))

	e := &Engine{
		shards: make([]*Shard, n),
		mask:   n - 1,
		count:  n,
	}

	for i := uint64(0); i < n; i++ {
		e.shards[i] = NewShard(reg, writer, fanout) // REFACTORED: Pass fanout
	}

	return e
}

func (e *Engine) Ingest(m *Message) {
	idx := uint64(m.DeviceKey) & e.mask
	e.shards[idx].Push(m)
}

func nextPowerOfTwo(v uint64) uint64 {
	if v == 0 {
		return 1
	}
	v--
	v |= v >> 1
	v |= v >> 2
	v |= v >> 4
	v |= v >> 8
	v |= v >> 16
	v |= v >> 32
	v++
	return v
}
