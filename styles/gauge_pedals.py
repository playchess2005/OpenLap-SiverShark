"""Rolling throttle/brake history on a fixed 0-100 percent scale."""
STYLE_NAME = 'Pedals'
ELEMENT_TYPE = 'gauge'

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyBboxPatch


def render(data: dict, w: int, h: int):
    from overlay_utils import fig_to_rgba, scale_factor

    throttle = np.clip(np.asarray(
        data.get('throttle_history') or [0.0], dtype=float), 0.0, 100.0)
    brake = np.clip(np.asarray(
        data.get('brake_history') or [0.0], dtype=float), 0.0, 100.0)
    n = max(len(throttle), len(brake), 2)
    if len(throttle) < n:
        throttle = np.pad(throttle, (n - len(throttle), 0), mode='edge')
    if len(brake) < n:
        brake = np.pad(brake, (n - len(brake), 0), mode='edge')

    th_now, br_now = float(throttle[-1]), float(brake[-1])
    theme = data.get('_tc', {})
    bg = theme.get('bg_rgba', (0.02, 0.03, 0.04, 0.82))
    edge = theme.get('bg_edge_rgba', (1.0, 1.0, 1.0, 0.14))
    text = theme.get('text', 'white')
    muted = theme.get('label', '#93a2b1')
    green, red = '#45d32f', '#ff3b30'

    sc = scale_factor(w, h, base_w=520, base_h=230)
    fig = plt.figure(figsize=(w / 100, h / 100), dpi=100)
    fig.patch.set_alpha(0)
    panel = fig.add_axes([0, 0, 1, 1])
    panel.axis('off')
    panel.add_patch(FancyBboxPatch(
        (0.01, 0.02), 0.98, 0.96, boxstyle='round,pad=0.015',
        facecolor=bg, edgecolor=edge, linewidth=max(0.7, sc)))

    chart = fig.add_axes([0.065, 0.19, 0.70, 0.68])
    chart.set_facecolor((0, 0, 0, 0))
    chart.set_xlim(0, n - 1)
    chart.set_ylim(0, 100)
    chart.set_xticks([])
    chart.set_yticks([0, 50, 100])
    chart.set_yticklabels(
        ['0', '50', '100'], color=muted, fontsize=max(5, int(7 * sc)))
    chart.tick_params(axis='y', length=0, pad=2)
    for level in (0, 50, 100):
        chart.axhline(level, color='white', alpha=0.10,
                      lw=max(0.4, 0.6 * sc), zorder=1)
    for spine in chart.spines.values():
        spine.set_visible(False)

    xs = np.arange(n)
    line_width = max(1.3, 2.2 * sc)
    chart.plot(xs, throttle, color=green, lw=line_width,
               solid_capstyle='round', solid_joinstyle='round', zorder=4)
    chart.plot(xs, brake, color=red, lw=line_width,
               solid_capstyle='round', solid_joinstyle='round', zorder=5)

    fs_label = max(6, int(8 * sc))
    fs_value = max(7, int(12 * sc))
    fs_unit = max(5, int(7 * sc))
    panel.text(0.065, 0.94, 'PEDAL HISTORY - 10 s',
               ha='left', va='top', color=muted, fontsize=fs_label,
               transform=panel.transAxes)
    panel.text(0.065, 0.08, '-10 s', ha='left', va='center',
               color=muted, fontsize=fs_unit, transform=panel.transAxes)
    panel.text(0.765, 0.08, 'NOW', ha='right', va='center',
               color=muted, fontsize=fs_unit, transform=panel.transAxes)

    def readout(x, label, value, colour):
        panel.text(x, 0.73, label, ha='center', va='center', color=colour,
                   fontsize=fs_label, fontweight='bold',
                   transform=panel.transAxes)
        panel.text(x, 0.50, f'{value:04.1f}', ha='center', va='center',
                   color=text, fontsize=fs_value, fontweight='bold',
                   transform=panel.transAxes)
        panel.text(x, 0.31, '%', ha='center', va='center', color=muted,
                   fontsize=fs_unit, transform=panel.transAxes)
        y0, bar_h = 0.13, 0.11
        panel.add_patch(plt.Rectangle(
            (x - 0.030, y0), 0.060, bar_h, facecolor='#172029',
            edgecolor='none', transform=panel.transAxes))
        panel.add_patch(plt.Rectangle(
            (x - 0.030, y0), 0.060, bar_h * value / 100.0,
            facecolor=colour, edgecolor='none', transform=panel.transAxes))

    readout(0.820, 'TH', th_now, green)
    readout(0.940, 'BR', br_now, red)
    return fig_to_rgba(fig, (w, h))
