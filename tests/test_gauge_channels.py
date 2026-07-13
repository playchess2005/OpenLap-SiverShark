import pytest
from gauge_channels import gauge_data, dummy_gauge_data, build_multi_data, GAUGE_CHANNELS

EXPECTED_GAUGE_KEYS = {'value', 'history_vals', 'label', 'unit', 'min_val', 'max_val',
                       'symmetric', 'channel'}


def test_gauge_data_speed():
    history = [{'speed': 120.0, 'gx': 0.0, 'gy': 0.0, 'lean': 0.0,
                'rpm': 0.0, 'exhaust_temp': 0.0, 't': 1.0}]
    result = gauge_data('speed', history)
    assert result['value'] == pytest.approx(120.0)


def test_gauge_data_empty_history_returns_zero():
    result = gauge_data('speed', [])
    assert result['value'] == pytest.approx(0.0)


def test_gauge_data_returns_required_keys():
    result = gauge_data('speed', [])
    assert EXPECTED_GAUGE_KEYS.issubset(result.keys())


def test_gauge_data_channel_field():
    result = gauge_data('speed', [])
    assert result['channel'] == 'speed'


def test_dummy_gauge_data_keys():
    result = dummy_gauge_data('speed')
    assert EXPECTED_GAUGE_KEYS.issubset(result.keys())


def test_dummy_gauge_data_has_history():
    result = dummy_gauge_data('speed')
    assert isinstance(result['history_vals'], list)
    assert len(result['history_vals']) > 0


def test_all_known_channels_work():
    for channel in GAUGE_CHANNELS:
        result = dummy_gauge_data(channel)
        assert result['channel'] == channel


# ── Speed unit conversion ───────────────────────────────────────────────────

def test_gauge_data_speed_default_unit_is_kmh():
    history = [{'speed': 120.0}]
    result = gauge_data('speed', history)
    assert result['value'] == pytest.approx(120.0)
    assert result['unit'] == 'km/h'
    assert result['max_val'] == pytest.approx(250)


def test_gauge_data_speed_mph_conversion():
    history = [{'speed': 120.0}]
    result = gauge_data('speed', history, unit='mph')
    assert result['value'] == pytest.approx(120.0 * 0.621371)
    assert result['unit'] == 'mph'
    assert result['min_val'] == pytest.approx(0)
    assert result['max_val'] == pytest.approx(250 * 0.621371)


def test_gauge_data_speed_ms_conversion():
    history = [{'speed': 36.0}]
    result = gauge_data('speed', history, unit='ms')
    assert result['value'] == pytest.approx(10.0)
    assert result['unit'] == 'm/s'


def test_gauge_data_non_speed_channel_ignores_unit():
    history = [{'rpm': 5000.0}]
    result = gauge_data('rpm', history, unit='mph')
    assert result['value'] == pytest.approx(5000.0)
    assert result['unit'] == 'rpm'


def test_gauge_data_does_not_mutate_gauge_channels():
    gauge_data('speed', [{'speed': 100.0}], unit='mph')
    assert GAUGE_CHANNELS['speed']['unit'] == 'km/h'
    assert GAUGE_CHANNELS['speed']['max'] == 250


def test_gauge_data_does_not_mutate_history():
    history = [{'speed': 100.0}]
    gauge_data('speed', history, unit='mph')
    assert history[0]['speed'] == 100.0


def test_build_multi_data_speed_conversion():
    history = [{'speed': 100.0, 'gy': 1.0}]
    ref_history = [{'speed': 90.0, 'gy': 0.5}]
    result = build_multi_data(['speed', 'gforce_lat'], history, ref_history, unit='mph')
    speed_entry = next(e for e in result['multi_channels'] if e['channel'] == 'speed')
    assert speed_entry['value'] == pytest.approx(100.0 * 0.621371)
    assert speed_entry['ref_values'][0] == pytest.approx(90.0 * 0.621371)
    assert speed_entry['unit'] == 'mph'
    lat_entry = next(e for e in result['multi_channels'] if e['channel'] == 'gforce_lat')
    assert lat_entry['value'] == pytest.approx(1.0)


def test_dummy_gauge_data_speed_unit():
    result = dummy_gauge_data('speed', unit='mph')
    assert result['unit'] == 'mph'
    assert result['max_val'] == pytest.approx(250 * 0.621371)
    assert all(v <= result['max_val'] + 1e-6 for v in result['history_vals'])
