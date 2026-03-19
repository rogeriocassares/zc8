package engine

import "github.com/rogeriocassares/zc8/packages/go-data"

type ParserRegistry struct {
	parsers map[data.ParserID]data.Parser
}

func NewRegistry() *ParserRegistry {
	return &ParserRegistry{
		parsers: make(map[data.ParserID]data.Parser),
	}
}

func (r *ParserRegistry) Register(id data.ParserID, p data.Parser) {
	r.parsers[id] = p
}

func (r *ParserRegistry) Get(id data.ParserID) data.Parser {
	return r.parsers[id]
}
