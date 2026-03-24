# SimScope

English | [Japanese](README.md)

![SimScope](https://github.com/user-attachments/assets/44532178-f40d-4d9c-bec3-4a4aa0079a61)

A visualizer for RoboCup Rescue Simulation (RCRS). You can connect to a running kernel in real time or replay log files.

## Getting Started

### GitHub Pages (file replay only)

Use it directly in your browser — no installation required.

<https://shima004.github.io/SimScope/>

> TCP connection and URL loading are not supported. Only local log file replay is available.

### Docker (recommended)

```sh
docker run --rm -p 3000:3000 ghcr.io/shima004/simscope:latest
```

Open <http://localhost:3000> in your browser.

### Run from source

```sh
npm install
npm run dev
```

---

## Usage

### Replay a log file

1. Click the **Open 7z tgz tar.gz xz log file** button
2. Select a log file
3. Use the slider and buttons to control playback

### Load from URL

Enter the log file URL in the **Log File** URL field of the Control Panel and click **Load**.

### Real-time connection (while kernel is running)

> **Note**: In real-time mode only viewer-oriented log data is received, so some features (e.g. Perception view) are unavailable. Loading a log file is recommended for full functionality.

1. Enter the kernel host and port in the **TCP Server** section of the top-left panel
   - Default: `localhost` / `27931`
2. Click **Connect**
3. Wait for `● Connected` to appear, then wait for the simulation to start

#### Connecting to a host kernel from WSL2

Add a route to the host machine with the `--add-host` option at startup:

```sh
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  ghcr.io/shima004/simscope:latest
```

Enter the following in the Control Panel:

- Host: `host.docker.internal`
- Port: `27931`

---

## URL Parameters

You can configure the initial behavior by appending query parameters to the URL.

| Parameter | Example                           | Description                        |
| --------- | --------------------------------- | ---------------------------------- |
| `host`    | `?host=192.168.1.10`              | TCP connection host                |
| `port`    | `?port=27931`                     | TCP connection port                |
| `url`     | `?url=https://example.com/log.7z` | Log file URL to load automatically |
| `team`    | `?team=TeamName`                  | Team name displayed on screen      |
| `map`     | `?map=Tokyo`                      | Map name displayed on screen       |

Multiple parameters can be combined:

```text
http://localhost:3000/?host=192.168.1.10&port=27931&team=MyTeam&map=Tokyo
```

```text
http://localhost:3000/?url=https://example.com/log.7z&team=MyTeam&map=Tokyo
```

---

## Controls

### Playback

| Button                   | Action                  |
| ------------------------ | ----------------------- |
| Play / Pause             | Start / pause auto-play |
| Prev                     | Step back one step      |
| Next                     | Step forward one step   |
| 0.5x / 1x / 2x / 4x / 8x | Change playback speed   |

### Entity interaction

- **Click on map** — Select an entity (click on an empty area to deselect)
- **Follow** — Camera follows the selected agent
- **Perception** — Switch to the selected agent/command center's perceived world (only available when an agent or command center is selected)
- **⚙️** — Show kernel configuration

---

## UI Overview

- **Map** — Displays buildings, roads, and agents
- **InfoPanel** — Detailed information and communication log for the selected entity
  - **📌** — Pin an entity to keep it displayed even when selecting others
- **CivilianStatusPanel** — Civilian alive/buried status (collapsible by clicking the header)
- **InjuredCivilianPanel** — List of injured civilians not in a refuge and not being carried
- **Score** — Simulation score
- **Injured in refuge** — Number of injured civilians in refuges / total injured
- **Blockade cleared** — Percentage of total blockade repair cost that has been cleared
