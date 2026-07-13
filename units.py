"""
units.py — Speed-unit conversion helpers
=========================================
Canonical internal storage of speed stays km/h everywhere (DataPoint.speed,
Lap.max_speed, GAUGE_CHANNELS bounds). This module converts at the display
boundary only: gauge rendering (preview + export) and, mirrored by hand in
frontend/js/pages/editor.js, the JS live-preview stack.
"""
import math

KMH_PER_UNIT = {'kmh': 1.0, 'mph': 0.621371, 'ms': 0.277778}
UNIT_LABELS  = {'kmh': 'km/h', 'mph': 'mph', 'ms': 'm/s'}

# Dial-ceiling rounding: "round the padded max up to a nice increment" tuned
# per unit so the dial doesn't look coarse (mph/m/s scales are smaller than km/h).
DIAL_ROUND_INCREMENT = {'kmh': 50.0, 'mph': 25.0, 'ms': 10.0}
DIAL_MIN_CEILING     = {'kmh': 50.0, 'mph': 30.0, 'ms': 15.0}

VALID_UNITS = ('auto', 'kmh', 'mph', 'ms')


def kmh_to_unit(value_kmh: float, unit: str) -> float:
    """Convert a km/h value into the given display unit."""
    return value_kmh * KMH_PER_UNIT.get(unit, 1.0)


def unit_label(unit: str) -> str:
    """Display label for a unit code, e.g. 'mph' -> 'mph', 'ms' -> 'm/s'."""
    return UNIT_LABELS.get(unit, 'km/h')


def resolve_speed_unit(config_speed_unit: str, session_source_unit: str) -> str:
    """Explicit config choice wins; 'auto' (or unset) falls back to whatever
    unit the session's source file was detected as using."""
    if config_speed_unit and config_speed_unit != 'auto':
        return config_speed_unit
    return session_source_unit or 'kmh'


def dial_ceiling(raw_max_kmh: float, unit: str) -> float:
    """Unit-aware equivalent of the km/h-only ceil(x/50)*50 dial-max rounding."""
    raw_max = kmh_to_unit(raw_max_kmh, unit)
    incr    = DIAL_ROUND_INCREMENT.get(unit, 50.0)
    floor   = DIAL_MIN_CEILING.get(unit, 50.0)
    return max(floor, math.ceil(raw_max * 1.10 / incr) * incr)
