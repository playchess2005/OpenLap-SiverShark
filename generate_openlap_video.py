import os
import sys
import struct
import datetime
import json
from math import ceil
from pathlib import Path
from os.path import getsize

import numpy as np
import can
import cantools
from telemetrik.parser import get_boxes, get_samples

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
WORKSPACE = Path(r"C:\Users\ASUS\Desktop\OpenLap")
VIDEO = Path(os.environ.get("OL_VIDEO", r"C:\Users\ASUS\Desktop\跑车数据记录\video\GH012730.MP4"))
BLF = Path(os.environ.get("OL_BLF", r"C:\Users\ASUS\Desktop\跑车数据记录\blf\9_5_18_15.blf"))
DBC_A = Path(os.environ.get("OL_DBC_A", r"C:\Users\ASUS\Desktop\跑车数据记录\dbc\Vehicle_CanA.dbc"))
DBC_B = Path(os.environ.get("OL_DBC_B", r"C:\Users\ASUS\Desktop\跑车数据记录\dbc\Vehicle_CanB_V2.dbc"))
DBC_CDC = Path(os.environ.get("OL_DBC_CDC", r"C:\Users\ASUS\Desktop\跑车数据记录\dbc\AgileFS-CDC20250724.dbc"))
CAN_A_CHANNEL = int(os.environ.get("OL_CAN_A_CHANNEL", "0"))
CAN_B_CHANNEL = int(os.environ.get("OL_CAN_B_CHANNEL", "1"))
CAN_CDC_CHANNEL = int(os.environ.get("OL_CAN_CDC_CHANNEL", "2"))

VIDEO_START_S = float(os.environ.get('OL_START', '21.0'))
VIDEO_END_S = float(os.environ.get('OL_END', '746.0'))
SYNC_ANALYSIS_END_S = float(os.environ.get('OL_SYNC_END', '746.0'))

def load_overlay_layout():
    raw = os.environ.get("OL_OVERLAY_LAYOUT", "").strip()
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and isinstance(data.get("gauges"), list):
                return data
        except Exception:
            pass
    return {
        "is_bike": False, "theme": "Dark",
        "gauges": [
            {"type": "G-Meter", "visible": True, "x": .02, "y": .02, "w": .18, "h": .28},
            {"type": "Dial", "channel": "rpm", "visible": True, "x": .02, "y": .70, "w": .15, "h": .27},
            {"type": "Numeric", "channel": "speed", "visible": True, "x": .18, "y": .70, "w": .10, "h": .27},
            {"type": "Steering", "channel": "SteeringWheelAngle", "visible": True, "x": .29, "y": .70, "w": .14, "h": .27},
            {"type": "Numeric", "channel": "CDC_YawRate", "visible": True, "x": .44, "y": .70, "w": .10, "h": .27},
            {"type": "Pedals", "visible": True, "x": .55, "y": .70, "w": .22, "h": .27},
            {"type": "Wheel Torque", "visible": True, "x": .78, "y": .70, "w": .20, "h": .27},
        ],
    }


def selected_raw_signals(layout):
    fields = ("channel", "throttle_channel", "brake_channel",
              "fl_channel", "fr_channel", "rl_channel", "rr_channel", "fl_error_channel", "fr_error_channel", "rl_error_channel", "rr_error_channel")
    keys = set()
    for gauge in layout.get("gauges", []):
        for field in fields:
            value = gauge.get(field)
            if isinstance(value, str) and value.startswith("blf::"):
                keys.add(value)
        for value in gauge.get("multi_channels", []) or []:
            if isinstance(value, dict):
                value = value.get("channel") or value.get("key")
            if isinstance(value, str) and value.startswith("blf::"):
                keys.add(value)
    by_frame = {}
    for key in keys:
        parts = key.split("::", 3)
        if len(parts) != 4:
            continue
        try:
            channel, frame_id = int(parts[1]), int(parts[2], 16)
        except ValueError:
            continue
        by_frame.setdefault((channel, frame_id), {})[parts[3]] = key
    return by_frame


OVERLAY_LAYOUT = load_overlay_layout()
RAW_SIGNALS_BY_FRAME = selected_raw_signals(OVERLAY_LAYOUT)


# ---------------------------------------------------------------------------
# GPMF helper
# ---------------------------------------------------------------------------
def parse_klv(data, offset, end, path=()):
    while offset < end:
        if offset + 8 > end:
            break
        key = data[offset:offset + 4].decode('latin1')
        tc = data[offset + 4:offset + 5]
        typ = None if tc == b'\x00' else tc.decode('latin1')
        struct_size = data[offset + 5]
        repeat = struct.unpack('>H', data[offset + 6:offset + 8])[0]
        raw_len = struct_size * repeat
        total = ceil((raw_len + 8) / 4) * 4
        if offset + total > end:
            total = end - offset
        data_start = offset + 8
        data_len = min(raw_len, end - data_start)
        new_path = path + (key,)
        yield new_path, key, typ, struct_size, repeat, data_start, data_len
        if typ is None:
            yield from parse_klv(data, data_start, min(data_start + data_len, end), new_path)
        offset += total


def find_gpmf_stbl_and_timescale(f):
    size = getsize(str(VIDEO))
    minf_boxes = get_boxes(f, 0, size, ["moov", "trak", "mdia", "minf"])
    stbl = None
    gpmf_minf = None
    for box in minf_boxes:
        if get_boxes(f, box.offset, box.size, ["minf", "gmhd", "gpmd"]):
            stbl = get_boxes(f, box.offset, box.size, ["minf", "stbl"])[0]
            gpmf_minf = box
            break
    if stbl is None:
        raise ValueError("video has no GPMF telemetry track")

    mdia_boxes = get_boxes(f, 0, size, ["moov", "trak", "mdia"])
    gpmf_mdia = None
    for mdia in mdia_boxes:
        if mdia.offset <= gpmf_minf.offset < mdia.offset + mdia.size:
            gpmf_mdia = mdia
            break
    timescale = 1000
    if gpmf_mdia:
        mdhd = get_boxes(f, gpmf_mdia.offset, gpmf_mdia.size, ["mdia", "mdhd"])[0]
        f.seek(mdhd.offset + 8)
        ver = f.read(1)[0]
        f.read(3)
        if ver == 1:
            f.read(16)
        else:
            f.read(8)
        timescale = int.from_bytes(f.read(4), "big") or 1000
    return stbl, timescale


def extract_video_gps():
    f = open(VIDEO, "rb")
    try:
        stbl, timescale = find_gpmf_stbl_and_timescale(f)
        samples = get_samples(f, stbl)
        pts = [s.pts for s in samples]
        out = {
            "t": [], "lat": [], "lon": [], "alt": [],
            "spd2_mps": [], "spd3_mps": [], "fix": [],
        }
        gpsu_first = None

        for i, s in enumerate(samples):
            f.seek(s.offset)
            payload = f.read(s.size)
            entries = list(parse_klv(payload, 0, len(payload)))
            gps5_entries = [e for e in entries if e[1] == "GPS5"]
            if not gps5_entries:
                continue

            # sample timing (seconds)
            t0 = pts[i] / timescale
            if i + 1 < len(pts):
                t1 = pts[i + 1] / timescale
            else:
                t1 = t0 + 1.0

            for e in gps5_entries:
                parent = e[0][:-1]
                scal = [1e7, 1e7, 1000, 1000, 100]
                fix = 0
                for me in entries:
                    if me[0] == parent + ("SCAL",) and me[2] == "l" and me[5] >= 20:
                        raw = payload[me[5]:me[5] + min(me[6], 20)]
                        scal = [struct.unpack(">i", raw[j:j + 4])[0] for j in range(0, 20, 4)]
                    if me[0] == parent + ("GPSF",):
                        raw = payload[me[5]:me[5] + min(me[6], 4)]
                        if raw:
                            fix = int.from_bytes(raw, "big")
                    if me[0] == parent + ("GPSU",) and gpsu_first is None:
                        raw = payload[me[5]:me[5] + min(me[6], 16)]
                        gpsu_first = raw.split(b"\x00", 1)[0].decode("ascii", "replace")

                data_start = e[5]
                data_len = e[6]
                n = e[4]
                struct_size = e[3]
                if struct_size < 20:
                    continue
                for j in range(n):
                    base = data_start + j * struct_size
                    if base + 20 > data_start + data_len:
                        break
                    vals = [struct.unpack(">i", payload[base + k:base + k + 4])[0] for k in range(0, 20, 4)]
                    lat = vals[0] / scal[0]
                    lon = vals[1] / scal[1]
                    alt = vals[2] / scal[2]
                    spd2 = vals[3] / scal[3]
                    spd3 = vals[4] / scal[4]
                    t = t0 + (j + 0.5) * (t1 - t0) / max(1, n)
                    out["t"].append(t)
                    out["lat"].append(lat)
                    out["lon"].append(lon)
                    out["alt"].append(alt)
                    out["spd2_mps"].append(spd2)
                    out["spd3_mps"].append(spd3)
                    out["fix"].append(fix)
    finally:
        f.close()

    order = np.argsort(out["t"])
    for k in out:
        out[k] = np.asarray(out[k], dtype=float)[order]
    return out, gpsu_first


# ---------------------------------------------------------------------------
# BLF helpers
# ---------------------------------------------------------------------------
def load_dbs():
    def optional(path):
        return cantools.database.load_file(str(path), strict=False) if path.is_file() else None
    return optional(DBC_A), optional(DBC_B), optional(DBC_CDC)


def load_bound_dbs():
    try:
        bindings = json.loads(os.environ.get("OL_DBC_BINDINGS", "{}"))
    except Exception:
        bindings = {}
    databases = {}
    for raw_channel, raw_values in bindings.items():
        try:
            channel = int(raw_channel)
        except (TypeError, ValueError):
            continue
        values = raw_values if isinstance(raw_values, list) else [raw_values]
        entries = []
        for raw_path in values:
            try:
                path = Path(str(raw_path))
                if path.is_file():
                    entries.append((path, cantools.database.load_file(str(path), strict=False)))
            except Exception:
                continue
        if entries:
            databases[channel] = entries
    return databases


def decode_blf_signals(start_blf_s, end_blf_s):
    db_a, db_b, db_cdc = load_dbs()
    bound_dbs = load_bound_dbs()
    motor_ids = {0x283, 0x284, 0x287, 0x288}
    wheel_by_id = {0x288: "FR", 0x287: "FL", 0x284: "RR", 0x283: "RL"}
    b_ids = {0x305, 0x505}
    cdc_ids = {0x270, 0x301, 0x302, 0x303, 0x304}

    signals = {
        "aps": ([], []),
        "steer": ([], []),
        "oil": ([], []),
        "brake": ([], []),
        "acc_pedal": ([], []),
        "cdc_lat": ([], []),
        "cdc_lgt": ([], []),
        "cdc_heave": ([], []),
        "cdc_yaw": ([], []),
        "torque_FL": ([], []),
        "torque_FR": ([], []),
        "torque_RL": ([], []),
        "torque_RR": ([], []),
    }
    signals.update({key: ([], []) for targets in RAW_SIGNALS_BY_FRAME.values() for key in targets.values()})
    motor = {aid: ([], []) for aid in motor_ids}
    debug_motor = {aid: ([], []) for aid in motor_ids}

    reader = can.BLFReader(str(BLF))
    blf_start = None
    for msg in reader:
        if blf_start is None:
            blf_start = msg.timestamp
        elapsed = msg.timestamp - blf_start
        if elapsed > end_blf_s + 20.0:
            break
        if elapsed < start_blf_s - 20.0:
            continue

        aid = msg.arbitration_id
        ch = int(msg.channel) if msg.channel is not None else 0
        decoded = None
        for _dbc_path, db in bound_dbs.get(ch, []):
            try:
                decoded = db.decode_message(int(aid), msg.data)
                break
            except Exception:
                continue
        if not decoded:
            continue

        if aid in motor_ids:
            if "AMK_ActualVelocity" in decoded:
                motor[aid][0].append(elapsed)
                motor[aid][1].append(float(decoded["AMK_ActualVelocity"]))
            if "AMK_ActualTorque" in decoded:
                torque_key = "torque_" + wheel_by_id[aid]
                signals[torque_key][0].append(elapsed)
                signals[torque_key][1].append(float(decoded["AMK_ActualTorque"]))

        debug_map = {
            "FL_ActualVelocity": 0x287, "FR_ActualVelocity": 0x288,
            "RL_ActualVelocity": 0x283, "RR_ActualVelocity": 0x284,
        }
        for signal_name, wheel_id in debug_map.items():
            if signal_name in decoded:
                debug_motor[wheel_id][0].append(elapsed)
                debug_motor[wheel_id][1].append(float(decoded[signal_name]))

        named = {
            "APS_OpenPct": "aps", "SteeringWheelAngle": "steer",
            "OilPressure_Kpa": "oil", "AB_BrkPdlPct": "brake",
            "AB_AccPdlPct": "acc_pedal", "CDC_LatAcc": "cdc_lat",
            "CDC_LgtAcc": "cdc_lgt", "CDC_HeaveAcc": "cdc_heave",
            "CDC_YawRate": "cdc_yaw",
        }
        for signal_name, output_name in named.items():
            if signal_name in decoded:
                signals[output_name][0].append(elapsed)
                signals[output_name][1].append(float(decoded[signal_name]))

        targets = RAW_SIGNALS_BY_FRAME.get((int(ch), int(aid)), {})
        for signal_name, output_key in targets.items():
            value = decoded.get(signal_name)
            if isinstance(value, (int, float)):
                signals[output_key][0].append(elapsed)
                signals[output_key][1].append(float(value))

    if any(debug_motor[aid][0] for aid in debug_motor):
        motor = debug_motor
    return signals, motor, blf_start


# ---------------------------------------------------------------------------
# Time mapping
# ---------------------------------------------------------------------------
def compute_offset_blf(blf_start, gpsu_first):
    # BLF timestamps are Beijing wall-clock encoded as Unix seconds (logger
    # convention here), while GoPro GPSU is UTC. Convert both to Beijing wall time.
    blf_bj = datetime.datetime.fromtimestamp(blf_start, datetime.timezone.utc).replace(tzinfo=None)
    yy = 2000 + int(gpsu_first[0:2])
    mo = int(gpsu_first[2:4])
    dd = int(gpsu_first[4:6])
    hh = int(gpsu_first[6:8])
    mi = int(gpsu_first[8:10])
    ss = int(gpsu_first[10:12])
    frac = int(gpsu_first[13:16]) if len(gpsu_first) >= 16 else 0
    gps_utc = datetime.datetime(yy, mo, dd, hh, mi, ss, frac * 1000)
    video_bj = gps_utc + datetime.timedelta(hours=8)
    return (video_bj - blf_bj).total_seconds()


# ---------------------------------------------------------------------------
# Main build + render
# ---------------------------------------------------------------------------
def find_best_offset(gps, offset0):
    """Refine the GPSU-derived offset by correlating video GPS speed with
    the average of the four AMK motor speeds."""
    analysis_end = max(VIDEO_END_S, SYNC_ANALYSIS_END_S)
    start_blf = offset0 + VIDEO_START_S - 120.0
    end_blf = offset0 + analysis_end + 120.0
    signals, motor, _ = decode_blf_signals(start_blf, end_blf)

    dt = 0.05
    blf_grid = np.arange(start_blf, end_blf, dt)
    motor_grids = []
    for aid in sorted(motor):
        t, v = motor[aid]
        t = np.asarray(t, dtype=float)
        v = np.asarray(v, dtype=float)
        if len(t) < 2:
            continue
        motor_grids.append(np.interp(blf_grid, t, v))
    if not motor_grids:
        return offset0
    rpm = np.mean([np.abs(m) for m in motor_grids], axis=0)

    video_grid = np.arange(0.0, analysis_end + 10.0, dt)
    video_speed = np.interp(video_grid, gps["t"], gps["spd2_mps"])
    win_mask = (video_grid >= VIDEO_START_S) & (video_grid <= analysis_end)
    vid_win = video_grid[win_mask]
    vr = video_speed[win_mask]

    best = None
    for off in np.arange(offset0 - 60.0, offset0 + 60.0, 0.2):
        bt = vid_win + off
        if bt[0] < blf_grid[0] or bt[-1] > blf_grid[-1]:
            continue
        mr = np.interp(bt, blf_grid, rpm)
        if np.std(vr) < 1e-6 or np.std(mr) < 1e-6:
            continue
        c = float(np.corrcoef(vr, mr)[0, 1])
        if best is None or c > best[0]:
            best = (c, off)
    return best[1] if best else offset0


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    # Source installs use imageio-ffmpeg's bundled executable, so users do not
    # need a system-wide FFmpeg or a machine-specific hard-coded path. An
    # explicit valid FFMPEG_BIN still wins.
    configured_ffmpeg = os.environ.get("FFMPEG_BIN", "")
    if not configured_ffmpeg or not Path(configured_ffmpeg).is_file():
        try:
            import imageio_ffmpeg
            bundled_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
            if bundled_ffmpeg and Path(bundled_ffmpeg).is_file():
                os.environ["FFMPEG_BIN"] = bundled_ffmpeg
                print("FFmpeg:", bundled_ffmpeg)
        except Exception as exc:
            print(f"WARNING: bundled FFmpeg unavailable: {exc}")

    gps = None
    gpsu_first = None
    try:
        candidate_gps, candidate_gpsu = extract_video_gps()
        if candidate_gpsu and len(candidate_gps.get("t", [])) >= 2:
            gps, gpsu_first = candidate_gps, candidate_gpsu
            print("video GPS samples:", len(gps["t"]), "first GPSU:", gpsu_first)
            print("video GPS speed range m/s:", float(np.nanmin(gps["spd2_mps"])), float(np.nanmax(gps["spd2_mps"])))
        else:
            print("WARNING: video has no usable GPMF GPS samples; continuing with BLF-only telemetry")
    except (ValueError, IndexError) as exc:
        print(f"WARNING: {exc}; continuing with BLF-only telemetry")

    # Read the BLF clock first. A manual Studio offset is sufficient even when
    # the source video has no GoPro GPMF/GPS metadata track.
    reader0 = can.BLFReader(str(BLF))
    first_msg = next(iter(reader0))
    blf_start = first_msg.timestamp
    reader0.stop() if hasattr(reader0, "stop") else None
    offset_setting = os.environ.get("OL_BLF_OFFSET", "1858.143").strip()
    if offset_setting.lower() == "auto":
        if gps is None or gpsu_first is None:
            raise ValueError(
                "automatic BLF alignment requires a video GPMF/GPS track; "
                "set a manual BLF offset/keyframe alignment in Studio")
        offset0 = compute_offset_blf(blf_start, gpsu_first)
        offset_blf = find_best_offset(gps, offset0)
        offset_source = "automatic whole-run correlation"
    else:
        offset_blf = float(offset_setting)
        offset_source = "manual Studio BLF offset"
    print("offset source:", offset_source)
    print(f"BLF start naive: {blf_start:.6f}, offset_blf(video0): {offset_blf:.6f}s")

    start_blf = offset_blf + VIDEO_START_S
    end_blf = offset_blf + VIDEO_END_S
    signals, motor, _ = decode_blf_signals(start_blf, end_blf)

    # Resample all signals onto video-time grid
    dt = 1.0 / 30.0
    grid = np.arange(0.0, VIDEO_END_S + dt, dt)
    grid = grid[(grid >= VIDEO_START_S) & (grid <= VIDEO_END_S)]
    blf_grid = grid + offset_blf

    def interp(t, v, default=0.0):
        t = np.asarray(t, dtype=float)
        v = np.asarray(v, dtype=float)
        if len(t) < 2:
            return np.full_like(blf_grid, default)
        return np.interp(blf_grid, t, v)

    def interp_shifted(pair, shift_s, default=0.0):
        t = np.asarray(pair[0], dtype=float)
        v = np.asarray(pair[1], dtype=float)
        if len(t) < 2:
            return np.full_like(blf_grid, default)
        return np.interp(blf_grid + shift_s, t, v, left=default, right=default)

    aps = interp(*signals["aps"])
    # Positive per-signal trims advance that signal relative to the video.
    steer_offset_s = float(os.environ.get("OL_STEER_OFFSET", "1.0"))
    yaw_offset_s = float(os.environ.get("OL_YAW_OFFSET", "0.0"))
    steer = interp_shifted(signals["steer"], steer_offset_s)
    oil = interp(*signals["oil"])
    brake = interp(*signals["brake"])
    acc_pedal = interp(*signals["acc_pedal"])
    cdc_lat = interp(*signals["cdc_lat"])
    cdc_lgt = interp(*signals["cdc_lgt"])
    cdc_heave = interp(*signals["cdc_heave"])
    cdc_yaw = interp_shifted(signals["cdc_yaw"], yaw_offset_s)
    torque_fl = interp(*signals["torque_FL"])
    torque_fr = interp(*signals["torque_FR"])
    torque_rl = interp(*signals["torque_RL"])
    torque_rr = interp(*signals["torque_RR"])
    raw_signal_values = {key: interp(*signals[key]) for key in signals if key.startswith("blf::")}

    def report_range(name, values):
        finite = np.asarray(values, dtype=float)
        finite = finite[np.isfinite(finite)]
        if not len(finite):
            print(f"{name}: no finite samples")
            return
        pct = np.percentile(finite, [0, 1, 50, 99, 100])
        print(
            f"{name}: min={pct[0]:.3f}, p01={pct[1]:.3f}, "
            f"median={pct[2]:.3f}, p99={pct[3]:.3f}, max={pct[4]:.3f}")

    report_range("APS_OpenPct [%]", aps)
    report_range("BrakePct [%]", brake)
    aps = np.clip(aps, 0.0, 100.0)
    brake = np.clip(brake, 0.0, 100.0)

    motor_grids = []
    for aid in sorted(motor):
        t, v = motor[aid]
        if len(t) < 2:
            motor_grids.append(np.zeros_like(blf_grid))
        else:
            motor_grids.append(np.interp(blf_grid, np.asarray(t, dtype=float), np.asarray(v, dtype=float)))
    rpm = np.mean([np.abs(m) for m in motor_grids], axis=0) if motor_grids else np.zeros_like(blf_grid)

    if gps is not None:
        # Video GPS aligned to the video-time grid.
        gps_lat = np.interp(grid, gps["t"], gps["lat"])
        gps_lon = np.interp(grid, gps["t"], gps["lon"])
        gps_alt = np.interp(grid, gps["t"], gps["alt"])
        gps_spd2 = np.interp(grid, gps["t"], gps["spd2_mps"])
        speed_kmh = np.clip(gps_spd2 * 3.6, 0.0, None)

        # Actual UTC datetime of video zero from GoPro GPSU.
        yy = 2000 + int(gpsu_first[0:2]); mo = int(gpsu_first[2:4]); dd = int(gpsu_first[4:6])
        hh = int(gpsu_first[6:8]); mi = int(gpsu_first[8:10]); ss = int(gpsu_first[10:12])
        frac = int(gpsu_first[13:16]) if len(gpsu_first) >= 16 else 0
        video0_utc = datetime.datetime(yy, mo, dd, hh, mi, ss, frac * 1000, tzinfo=datetime.timezone.utc)
    else:
        # Ordinary/transcoded videos may have no GPMF track. BLF-bound gauges
        # still export normally; only GPS-derived speed, altitude and map data
        # are unavailable.
        gps_lat = np.zeros_like(grid)
        gps_lon = np.zeros_like(grid)
        gps_alt = np.zeros_like(grid)
        speed_kmh = np.zeros_like(grid)
        video0_utc = datetime.datetime.fromtimestamp(
            blf_start + offset_blf, tz=datetime.timezone.utc)
        print("GPS-derived speed/altitude/map data unavailable for this video")

    from data_model import DataPoint, Lap, Session

    all_points = []
    for i, vt in enumerate(grid):
        all_points.append(DataPoint(
            record=i,
            time=video0_utc + datetime.timedelta(seconds=float(vt)),
            lat=float(gps_lat[i]),
            lon=float(gps_lon[i]),
            alt=float(gps_alt[i]),
            speed=float(speed_kmh[i]),
            gforce_x=float(cdc_lgt[i]) / 9.80665,
            gforce_y=float(cdc_lat[i]) / 9.80665,
            gforce_z=float(cdc_heave[i]) / 9.80665,
            lap=1,
            gyro_x=0.0,
            gyro_y=0.0,
            gyro_z=0.0,
            lean_angle=0.0,
            elapsed=float(vt),
            lap_elapsed=float(vt - VIDEO_START_S),
            rpm=float(rpm[i]),
            exhaust_temp=0.0,
            gear=0,
            extra={
                "APS_OpenPct": float(aps[i]),
                "BrakePct": float(brake[i]),
                "SteeringWheelAngle": float(steer[i]),
                "OilPressure_Kpa": float(oil[i]),
                "Torque_FL": float(torque_fl[i]),
                "Torque_FR": float(torque_fr[i]),
                "Torque_RL": float(torque_rl[i]),
                "Torque_RR": float(torque_rr[i]),
                "CDC_LatAcc": float(cdc_lat[i]),
                "CDC_LgtAcc": float(cdc_lgt[i]),
                "CDC_HeaveAcc": float(cdc_heave[i]),
                "CDC_YawRate": float(cdc_yaw[i]),
                **{key: float(values[i]) for key, values in raw_signal_values.items()},
            },
        ))

    lap_pts = [p for p in all_points if VIDEO_START_S <= p.elapsed <= VIDEO_END_S + 1e-6]
    lap = Lap(lap_num=1, points=lap_pts, duration=VIDEO_END_S - VIDEO_START_S)
    sess = Session(
        source="BLF 9_5_18_15 + DBC",
        date_utc=video0_utc.isoformat(),
        track="Run",
        configuration="",
        session_type="Driving",
        best_lap_time=0.0,
        all_points=all_points,
        laps=[lap],
        is_bike=False,
        source_speed_unit="kmh",
        extra_channel_meta={
            "APS_OpenPct": {"label": "Throttle", "unit": "%"},
            "BrakePct": {"label": "Brake", "unit": "%"},
            "SteeringWheelAngle": {"label": "Steering Angle", "unit": "\u00b0"},
            "Torque_FL": {"label": "Front Left", "unit": "N\u00b7m"},
            "Torque_FR": {"label": "Front Right", "unit": "N\u00b7m"},
            "Torque_RL": {"label": "Rear Left", "unit": "N\u00b7m"},
            "Torque_RR": {"label": "Rear Right", "unit": "N\u00b7m"},
        },
    )

    layout = OVERLAY_LAYOUT

    from video_renderer import render_lap, RenderJob

    out_name = os.environ.get("OL_OUT", "GH012730_driving_v3_pedals_wheel_torque.mp4")
    out_path = os.environ.get("OL_OUTPUT") or str(WORKSPACE / "output" / out_name)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)

    render_lap(
        video_path=str(VIDEO),
        out_path=out_path,
        session=sess,
        job=RenderJob("Driving", lap),
        sync_offset=0.0,
        encoder="libx264",
        crf=18,
        n_workers=int(os.environ.get("OL_WORKERS", "1")),
        show_map=False,
        show_telemetry=True,
        padding=0.0,
        is_bike=False,
        overlay_layout=layout,
        progress_cb=lambda pct, msg: print(f"  {pct:5.1f}% {msg}", flush=True),
        log_cb=lambda msg: print(msg, flush=True),
        reference_lap=None,
        info_overrides={},
        overlay_only=False,
        track_map_geometry=None,
        track_map_areas=None,
        speed_unit="kmh",
        is_cancelled=lambda: False,
    )


if __name__ == "__main__":
    main()














