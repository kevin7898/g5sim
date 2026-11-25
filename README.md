# g5sim

A G5 Universal-style display for **Farming Simulator 25** that runs on an iPad (or any browser),
fed live by an FS25 mod through a small bridge on the gaming PC.

```
FS25 (Windows PC)                         same PC                       iPad / browser
FS25_G5Link mod -- telemetry.xml -->  G5Link bridge (Node.js) -- live stream -->  G5 display
                <-- commands.xml --                              <-- taps ----
```

| Folder | What it is |
|---|---|
| [`G5Link/`](G5Link/) | The project: FS25 mod, Node bridge, web display app, build tools. Start with [G5Link/README.md](G5Link/README.md) for install and use. |
| [`G5Link/dist/`](G5Link/dist/) | Built zips: `FS25_G5Link.zip` (mod) and `G5Link-PC.zip` (bridge + app). |
| [`research/`](research/) | Study notes from the Deere Display Simulator and the G5 help center (944 pages), plus the site exploration log. |
| [`NOTES.md`](NOTES.md) | **Handoff notes**: current status, what's verified vs. assumed, design reference, next steps. |
| [`CLAUDE.md`](CLAUDE.md) | Context for Claude Code when working on this repo. |

## Quick start (no game needed)

```bash
node G5Link/bridge/g5link-bridge.js --demo
```

Open the printed address (for example `http://localhost:8765`) in a browser. A simulated tractor and
planter drive around, and every key works.

Rebuild the zips after changes:

```bash
python3 G5Link/tools/package.py
```
