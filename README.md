# TERRIFRONT

> **A real-time territory game built around one simple idea:**
> take ground, hold the line, and make the map yours.

<p align="center">
  <strong>Node.js</strong> &nbsp;•&nbsp; <strong>WebSockets</strong> &nbsp;•&nbsp; <strong>Canvas rendering</strong> &nbsp;•&nbsp; <strong>Binary protocol</strong>
</p>

TerriFront is a browser-based multiplayer strategy game played on a large real-world map. Players choose a capital, expand across neighbouring territory, manage troop strength, and use boats to open distant fronts. A lightweight Node.js server runs the simulation while the browser renders the map and HUD in real time.

## Features

- Live multiplayer matches over WebSockets
- Territory capture with continuous simulation ticks
- Spawn selection and capital placement
- Troop economy tied to controlled territory
- Bot opponents and an in-game leaderboard
- Sea crossings with route finding, troop decay, and beachhead landings
- Compact binary messages for efficient game updates
- Map assets baked and served by the project itself

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:8080](http://localhost:8080) in a browser and enter a player name.

The server runs the map-baking step automatically before launch. To build the distributable HTML separately:

```bash
npm run build
```

Useful scripts:

| Command | Purpose |
| --- | --- |
| `npm start` | Bake the map and start the HTTP/WebSocket server |
| `npm run build` | Build `dist/terrifront.html` |
| `npm run bake-map` | Generate the baked map data and timing assets |

To use another port:

```bash
PORT=8081 npm start
```

On Windows PowerShell:

```powershell
$env:PORT = 8081; npm start
```

## How To Play

1. Enter a name and press **Play**.
2. Choose a starting position during the spawn phase.
3. Select enemy or neutral land on the map.
4. Choose an expansion or boat action, then set the troop ratio.
5. Grow your territory, protect your borders, and outlast the other players.

## Multiplayer

TerriFront now includes an early true-multiplayer flow built around a rolling lobby:

```text
Open lobby (30 seconds)
  |
  +-- nobody joins --> discard lobby --> create the next lobby
  |
  +-- players join --> start one shared match --> create the next lobby
```

Players who press **Play** first see the current map-backed lobby. The player list, countdown, and lobby capacity update live over WebSockets. When the timer ends, every player in that lobby enters the same server-authoritative match and receives shared spawn, territory, boat, and player updates. A new lobby is opened immediately for the next group of players.

The multiplayer implementation is split into focused areas:

- `backend/multiplayer/` manages lobby state and the rolling lobby timer.
- `backend/game-master-main/` creates shared match engines and fills remaining slots with bots.
- `backend/websocket.js` manages lobby observers, match socket groups, broadcasts, and action ownership checks.
- `shared/binary-protocol.js` carries lobby, spawn, and game messages as compact binary packets.
- `frontend/index.js` and `frontend/index.html` provide the lobby experience before handing control to the game UI.

### Early-stage limitations

This is the first multiplayer implementation and is not production infrastructure yet:

- Lobby and match state live in server memory and disappear when the Node.js process stops.
- It is designed for one server process; there is no database, shared session store, or multi-server scaling layer.
- There is one rolling public lobby rather than private rooms, matchmaking filters, or invites.
- The lobby timer is fixed at 30 seconds and matches target 250 total players, using bots to fill open slots.
- Reconnection, persistent accounts, moderation, rate limiting, and durable match history are not implemented yet.
- A disconnected player is not yet guaranteed a full session-resume flow.
- Multiplayer load testing beyond local two-client verification is still pending.

The current priority is correctness and a clear shared-match lifecycle. Persistence, reconnection, stronger session management, and horizontal scaling should be added before treating the system as production-ready.

## Project Shape

```text
backend/       Simulation, game rooms, bots, territory, expansion, boats
frontend/      Browser UI, map rendering, labels, and WebSocket client
shared/        Binary protocol and shared game rules
builder/       Bundles the browser client into dist/
scripts/       Map baking utilities
map/           Baked map data and manifests
Assets/        Game artwork and interface assets
```

The server is authoritative: gameplay state is mutated on the backend, serialized through the shared binary protocol, and merged into the client-side view. Updates are sent as deltas where possible so quiet ticks do not retransmit unchanged player state.

## Acknowledgment

TerriFront was heavily informed by studying **WarFront** and related territory, rendering, player, bot, and attack systems. This project is an independent implementation and is not affiliated with or endorsed by WarFront.

## Status

TerriFront is an active experimental project. The core multiplayer loop, map rendering, expansion, bots, binary updates, and boat mechanics are in place; balance and deeper performance work are still evolving.

## License

TerriFront is licensed under the **GNU General Public License v3.0-only**. See [LICENSE](LICENSE) for the project license notice and the official GNU terms.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CLA.md](CLA.md) before submitting code, artwork, map data, or documentation.