module.exports = Object.freeze({
  maxPayloadBytes: 64 * 1024,
  maxConnectionsPerIp: 20,
  connectionWindowMs: 60 * 1000,
  inboundMessagesPerSecond: 30,
  inboundMessageBurst: 60,
  inboundBytesPerSecond: 256 * 1024,
  inboundBytesBurst: 512 * 1024,
  outboundBytesPerSecond: 512 * 1024,
  outboundBytesBurst: 1024 * 1024
});
