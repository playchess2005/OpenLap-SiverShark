import pytest
from units import kmh_to_unit, unit_label, resolve_speed_unit, dial_ceiling


def test_kmh_to_unit_kmh_identity():
    assert kmh_to_unit(100.0, 'kmh') == pytest.approx(100.0)


def test_kmh_to_unit_mph():
    assert kmh_to_unit(160.934, 'mph') == pytest.approx(100.0, abs=1e-3)


def test_kmh_to_unit_ms():
    assert kmh_to_unit(36.0, 'ms') == pytest.approx(10.0)


def test_kmh_to_unit_unknown_defaults_to_identity():
    assert kmh_to_unit(50.0, 'bogus') == pytest.approx(50.0)


def test_unit_label():
    assert unit_label('kmh') == 'km/h'
    assert unit_label('mph') == 'mph'
    assert unit_label('ms') == 'm/s'
    assert unit_label('bogus') == 'km/h'


@pytest.mark.parametrize('config_unit,session_unit,expected', [
    ('auto', 'kmh', 'kmh'),
    ('auto', 'mph', 'mph'),
    ('auto', '', 'kmh'),
    ('auto', None, 'kmh'),
    ('mph', 'ms', 'mph'),   # explicit config choice always wins
    ('', 'mph', 'mph'),     # unset config treated as auto
    (None, 'ms', 'ms'),
])
def test_resolve_speed_unit(config_unit, session_unit, expected):
    assert resolve_speed_unit(config_unit, session_unit) == expected


def test_dial_ceiling_kmh_rounds_to_50():
    # 120 km/h * 1.10 = 132 -> ceil to nearest 50 -> 150
    assert dial_ceiling(120.0, 'kmh') == pytest.approx(150.0)


def test_dial_ceiling_respects_minimum_floor():
    assert dial_ceiling(1.0, 'kmh') == pytest.approx(50.0)
    assert dial_ceiling(1.0, 'mph') == pytest.approx(30.0)
    assert dial_ceiling(1.0, 'ms') == pytest.approx(15.0)


def test_dial_ceiling_unit_aware_increment():
    # Same raw km/h max, different unit -> different (converted + rounded) ceilings
    raw_max_kmh = 200.0
    kmh_ceil = dial_ceiling(raw_max_kmh, 'kmh')
    mph_ceil = dial_ceiling(raw_max_kmh, 'mph')
    ms_ceil  = dial_ceiling(raw_max_kmh, 'ms')
    assert kmh_ceil % 50 == 0
    assert mph_ceil % 25 == 0
    assert ms_ceil % 10 == 0
