package influx

type WriteModel interface {
	DeviceKey() string
	Database() string
	LineProtocol() string
}
