package nats

// RealtimePublisher is DEPRECATED. The zc8 platform has migrated to a
// JetStream-only architecture for full auditability. All telemetry events
// are now published to the DATA stream (subjects: data.{orgId}.{teamId}.{deviceKey}.raw
// and data.{orgId}.{teamId}.{deviceKey}.decoded). Browser clients consume
// these via JetStream ordered consumers, not NATS Core subscriptions.
//
// Service status events are published to the SVC stream
// (subjects: svc.{orgId}.{svcId}) as ServiceEvent proto messages.
//
// This file is retained for documentation purposes only. Do not use
// RealtimePublisher in new code — it publishes to NATS Core subjects
// (telemetry.realtime.*) that are no longer subscribed to by any component.
