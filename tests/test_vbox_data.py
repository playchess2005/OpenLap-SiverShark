import pytest
from vbox_data import load_vbo


def _write_vbo(tmp_path, channel_lines, data_row, unit_lines=None, name='session.vbo'):
    lines = ['[header]']
    lines += channel_lines
    lines.append('')
    if unit_lines is not None:
        lines.append('[channel units]')
        lines += unit_lines
        lines.append('')
    lines.append('[comments]')
    lines.append('File created on 15/06/2024 at 14:32:00 by VBOX Tools')
    lines.append('')
    lines.append('[data]')
    lines.append(data_row)
    path = tmp_path / name
    path.write_text('\n'.join(lines), encoding='utf-8')
    return str(path)


def test_load_vbo_velocity_kmh(tmp_path):
    path = _write_vbo(
        tmp_path,
        ['time', 'latitude north', 'longitude east', 'velocity kmh'],
        '120000.00 5130.0000 00400.0000 100.0',
    )
    session = load_vbo(path)
    assert session.source_speed_unit == 'kmh'
    assert session.all_points[0].speed == pytest.approx(100.0)


def test_load_vbo_velocity_mph(tmp_path):
    path = _write_vbo(
        tmp_path,
        ['time', 'latitude north', 'longitude east', 'velocity mph'],
        '120000.00 5130.0000 00400.0000 100.0',
    )
    session = load_vbo(path)
    assert session.source_speed_unit == 'mph'
    assert session.all_points[0].speed == pytest.approx(100.0 * 1.60934)


def test_load_vbo_velocity_ms_via_channel_units(tmp_path):
    path = _write_vbo(
        tmp_path,
        ['time', 'latitude north', 'longitude east', 'velocity'],
        '120000.00 5130.0000 00400.0000 10.0',
        unit_lines=['s', 'deg', 'deg', 'm/s'],
    )
    session = load_vbo(path)
    assert session.source_speed_unit == 'ms'
    assert session.all_points[0].speed == pytest.approx(36.0)


def test_load_vbo_bare_velocity_defaults_kmh(tmp_path):
    # Bare 'velocity' with no unit tag is treated as knots internally, but
    # 'knots' isn't a selectable display unit, so source_speed_unit falls
    # back to 'kmh' (a known limitation — see units.py plan notes).
    path = _write_vbo(
        tmp_path,
        ['time', 'latitude north', 'longitude east', 'velocity'],
        '120000.00 5130.0000 00400.0000 100.0',
    )
    session = load_vbo(path)
    assert session.source_speed_unit == 'kmh'
