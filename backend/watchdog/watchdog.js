const TokenBucket = require('./token-bucket');
const defaultConfig = require('./watchdog-config');

class WatchDog {
  constructor(config = {}, now = () => Date.now()) {
    this.config = { ...defaultConfig, ...config };
    this.now = now;
    this.connections = new WeakMap();
    this.ipConnections = new Map();
  }

  accept(socket, address) {
    const currentTime = this.now();
    const entry = this.ipConnections.get(address) || { count: 0, windowStartedAt: currentTime };
    if (currentTime - entry.windowStartedAt >= this.config.connectionWindowMs) {
      entry.count = 0;
      entry.windowStartedAt = currentTime;
    }
    if (entry.count >= this.config.maxConnectionsPerIp) {
      socket.close(1008, 'Connection rate limit exceeded');
      return false;
    }

    entry.count += 1;
    this.ipConnections.set(address, entry);
    this.connections.set(socket, {
      address,
      inboundMessages: new TokenBucket(
        this.config.inboundMessageBurst,
        this.config.inboundMessagesPerSecond,
        this.now
      ),
      inboundBytes: new TokenBucket(
        this.config.inboundBytesBurst,
        this.config.inboundBytesPerSecond,
        this.now
      ),
      outboundBytes: new TokenBucket(
        this.config.outboundBytesBurst,
        this.config.outboundBytesPerSecond,
        this.now
      )
    });
    return true;
  }

  allowMessage(socket, payload) {
    const state = this.connections.get(socket);
    if (!state) return false;
    const size = this.getPayloadSize(payload);
    return size <= this.config.maxPayloadBytes &&
      state.inboundMessages.consume() &&
      state.inboundBytes.consume(size);
  }

  send(socket, payload) {
    const state = this.connections.get(socket);
    if (!state || socket.readyState !== 1) return false;
    const size = this.getPayloadSize(payload);
    if (size > this.config.maxPayloadBytes || !state.outboundBytes.consume(size)) return false;
    socket.send(payload);
    return true;
  }

  release(socket) {
    const state = this.connections.get(socket);
    if (!state) return;
    const entry = this.ipConnections.get(state.address);
    if (entry) {
      entry.count = Math.max(0, entry.count - 1);
      if (entry.count === 0) this.ipConnections.delete(state.address);
    }
    this.connections.delete(socket);
  }

  getPayloadSize(payload) {
    if (typeof payload === 'string') return Buffer.byteLength(payload);
    if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) return payload.byteLength;
    if (payload instanceof ArrayBuffer) return payload.byteLength;
    if (ArrayBuffer.isView(payload)) return payload.byteLength;
    return 0;
  }
}

module.exports = WatchDog;
