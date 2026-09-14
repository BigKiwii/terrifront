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