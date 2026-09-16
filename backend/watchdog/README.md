# WatchDog

WatchDog is the transport-protection boundary between TerriFront clients and the game server.

## Current responsibility

- Limit WebSocket frame size.
- Limit inbound messages per connection.
- Limit inbound bytes per connection.
- Limit outbound bytes per connection.
- Limit active connections per client address.
- Release connection state when sockets close.

WatchDog does not inspect gameplay meaning yet. Authentication, anti-cheat rules, suspicious-action detection, distributed counters, and network-level DDoS protection are future layers.

## Architecture

```text
Client
  |
  v
WebSocket transport
  |
  v
WatchDog
  |-- connection admission
  |-- inbound message and byte buckets
  |-- outbound byte bucket
  |-- payload-size guard
  v
Binary protocol decoder / encoder
  |
  v
Lobby and game services
```

`watchdog.js` owns connection state and policy decisions. `token-bucket.js` is deliberately generic so future limits can be added without coupling them to WebSocket code. `watchdog-config.js` is the only place for the initial rate policy.

The current limits are process-local and per server instance. A reverse proxy, firewall, CDN, or distributed rate-limit store is still required for meaningful network-level DDoS protection in production.
