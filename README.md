# OpenLap Studio

[English](README.md) | [简体中文](README.zh-CN.md)

OpenLap is a free, open-source motorsport video and telemetry tool. This
repository is the **playchess2005** edition of OpenLap, focused on a practical
workflow for combining a race video with Vector BLF/CAN data and turning the
decoded signals into an overlay.

This project is based on the original [OpenLap by LaurensVR3](https://github.com/LaurensVR3/OpenLap/tree/main).
The Studio, BLF/DBC, Signal and keyframe-alignment work described below is the
development in this repository; it is not presented as part of the original
project.

The current release is **v0.4.0**. Its main workflow is the Studio workspace:

```text
MP4/video + Vector BLF
        ↓
BLF channel scan → DBC binding → Signal selection
        ↓
manual video/BLF alignment with keyframes
        ↓
overlay cards and gauges → rendered video
```

OpenLap runs locally. Your video, BLF files and DBC files are not uploaded to
a server. It is licensed under the GNU GPL v3 (or later).

## What makes this version different

The features below describe this repository rather than the original upstream
project:

- **BLF + video alignment** — load a video and a Vector `.blf` file in Studio,
  inspect the same run on one timeline, and set the relationship between video
  time and BLF time precisely.
- **DBC-aware decoding** — bind one or more `.dbc` databases to each BLF
  channel. The binding is explicit, saved with the project, and used to decode
  CAN frames into named physical signals.
- **Signal-first workflow** — after decoding, search and select individual
  `Message.Signal` items by channel, CAN ID, message name, signal name, unit or
  DBC file. Only the selected tracks need to be read for the Studio timeline.
- **Keyframe alignment** — place keyframes on recognizable events, select a
  keyframe, and align it to the current video position. Keyframes can be
  added, selected, removed and reviewed while zooming or panning the timeline.
- **Track-specific correction** — use a global BLF offset and optional
  per-track offsets for signals that need a small independent correction (for
  example steering or yaw rate).
- **Reusable overlays** — continue from Studio to the Overlay editor, add
  cards such as steering, pedals, four-wheel torque and yaw-rate views, and
  combine them with numeric, dial, bar, line, map and session widgets.

## Studio workflow

### 1. Choose the material

Open **Studio**, choose the race video and the Vector BLF log, then select
**Load material**. BLF channel scanning reports progress, frame counts and an
ETA. Results are cached so returning to the same file does not require an
unnecessary full scan.

### 2. Bind DBC files to BLF channels

Open **DBC configuration** and scan the BLF. For every discovered channel you
can add one or more DBC files. The order is significant when more than one DBC
can decode the same CAN ID: OpenLap tries the bindings in list order and reports
conflicts instead of silently hiding them.

A DBC is not the log itself; it describes how message bytes become signals
(start bit, length, byte order, scale, offset, unit and value choices).

### 3. Select signals

Use **Signal** selection to scan the DBC-bound BLF and create a catalog of
available signals. Search by BLF channel, CAN ID, message name, signal name,
unit, DBC filename or source. Select any number of signals and give the
resulting tracks meaningful display names in Studio.

### 4. Align BLF data with the video

Studio shows the video preview and a multi-track BLF timeline together.

- Set the **global BLF offset** to establish the video-to-BLF relationship.
- Use the scrub bar or click the waveform to move the video to an event.
- Double-click the timeline to add a keyframe; select a keyframe and use
  **Align keyframe** to make that BLF event coincide with the current video
  frame.
- Right-click or use the keyframe controls to remove an incorrect marker.
- Zoom into a short event for fine alignment, or reset to the global view to
  check drift across the whole recording.
- Apply an independent steering or yaw offset when a particular signal needs a
  small correction after the global alignment is correct.

Positive track offsets mean that the signal is shown earlier in the video. All
offsets are saved in the Studio project and are used again during export.

### 5. Build and export the overlay

Choose **Next: edit Overlay** after alignment. Studio keeps the loaded
trajectory available while the Overlay editor is open, so switching pages does
not start a second BLF read. Add and resize cards, map them to the selected
signals, preview the result, then export the chosen interval to a video file.

The export panel shows progress, logs and final output validation. A video
without GoPro/GPMF telemetry can still be aligned manually against BLF; video
metadata is optional for this workflow.

## Other telemetry sources

The classic **Data** page remains available for sessions from:

| Source | Common files |
| --- | --- |
| RaceBox | `.csv` |
| AIM MyChron | `.xrk`, `.xrz`, `.drk` |
| MoTeC | `.ld` |
| GPX | `.gpx` |
| VBOX | `.vbo` |
| Unipro Laptimer | `.tsv`, `.uni` |

These sources use the existing session/lap workflow. Studio is the dedicated
BLF/DBC workflow; it does not require converting a BLF into a generic CSV
before alignment.

## Install and run from source

Python 3.10 or newer is required. The dependency set includes the BLF and DBC
stack (`python-can` and `cantools`), scientific processing libraries, the
pywebview desktop shell, and a bundled FFmpeg binary for source installs.

```bash
git clone https://github.com/playchess2005/OpenLap-SiverShark.git
cd OpenLap-SiverShark
python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate

python -m pip install --upgrade pip
pip install -e .
python main.py
```

For the optional RaceBox cloud downloader:

```bash
pip install -e ".[racebox-download]"
playwright install chromium
```

On Windows, download the packaged installer or portable build from this
repository's [Releases](https://github.com/playchess2005/OpenLap-SiverShark/releases)
page when a release is available.

## Development

```bash
pytest
npm install
npm run test:run
```

The main Studio source areas are:

- `frontend/js/pages/studio.js` — material loading, timeline and alignment UI
- `frontend/js/pages/dbc.js` — BLF channel discovery and DBC bindings
- `frontend/js/pages/signals.js` — decoded Signal catalog and track selection
- `webview_api.py` — BLF/DBC scanning, trajectory caching and export bridge
- `generate_openlap_video.py` — Studio video rendering

## Project ownership and attribution

This repository is maintained and published by **playchess2005**. It is based
on the original [LaurensVR3/OpenLap](https://github.com/LaurensVR3/OpenLap/tree/main)
and remains GPL-licensed. Please retain the original copyright and license
notices when redistributing modified source or binaries.

## License

OpenLap is distributed under the [GNU General Public License v3.0 or later](LICENSE).
