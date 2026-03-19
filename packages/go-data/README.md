# go-data

Core data types and interfaces for the zc8 platform.

## Purpose

Provides unified data structures used across multiple services:

- **Parsing**: `Field`, `Parser` interface, `ParserID`
- **Normalization**: `NormalizedMessage`, `FieldMetadata`
- **Identity**: `DeviceKey`, `DeviceMeta`

## Types

### Parsing Types

- `Field`: Represents a parsed measurement (Key + Value)
- `Parser`: Interface for payload parsing implementations
- `ParserID`: Identifies which parser implementation to use

### Normalization Types

- `NormalizedMessage`: Standard format for device messages
- `FieldMetadata`: Metadata about field definitions

### Identity Types

- `DeviceKey`: Fast uint64 identity (derived from UUIDv7)
- `DeviceMeta`: Device metadata including parser reference

## Design

This package:

- Contains **ONLY types and interfaces** (no implementation)
- Has **zero external dependencies** (only stdlib)
- Breaks circular imports between go-parser and go-stream
- Provides single source of truth for shared types

## Used By

- `go-parser`: Parser interface and Field type
- `go-normalizer`: NormalizedMessage and FieldMetadata types
- `go-stream`: DeviceKey, ParserID, DeviceMeta types
- All adapters and services using these types
