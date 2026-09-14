"""Top-down display of four independently decoded motor torques."""
STYLE_NAME = 'Wheel Torque'
ELEMENT_TYPE = 'gauge'

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon


def render(data: dict, w: int, h: int):
    from overlay_utils import fig_to_rgba, scale_factor, fit_text_to_width

    values = {key: float(data.get(key, 0.0))
              for key in ('FL', 'FR', 'RL', 'RR')}
    theme = data.get('_tc', {})
    bg = theme.get('bg_rgba', (0.02, 0.03, 0.04, 0.82))
    edge = theme.get('bg_edge_rgba', (1.0, 1.0, 1.0, 0.14))
    muted = theme.get('label', '#93a2b1')
    positive, negative = '#45d32f', '#ff8b2d'

    sc = scale_factor(w, h, base_w=330, base_h=260)
    fig = plt.figure(figsize=(w / 100, h / 100), dpi=100)
    fig.patch.set_alpha(0)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis('off')
    ax.add_patch(FancyBboxPatch(
        (0.02, 0.02), 0.96, 0.96, boxstyle='round,pad=0.02',
        facecolor=bg, edgecolor=edge, linewidth=max(0.7, sc)))

    fs_title = max(6, int(8 * sc))
    fs_label = max(6, int(8 * sc))
    fs_value = max(7, int(12 * sc))
    ax.text(0.5, 0.94, 'WHEEL TORQUE',
            ha='center', va='top', color=muted, fontsize=fs_title)

    # Front axle is the upper one; this makes FL/FR vs RL/RR explicit.
    ax.plot([0.34, 0.66], [0.70, 0.70],
            color='white', alpha=0.35, lw=max(1, sc))
    ax.plot([0.34, 0.66], [0.29, 0.29],
            color='white', alpha=0.35, lw=max(1, sc))
    ax.add_patch(Polygon(
        [(0.43, 0.18), (0.39, 0.34), (0.40, 0.67), (0.46, 0.82),
         (0.54, 0.82), (0.60, 0.67), (0.61, 0.34), (0.57, 0.18)],
        closed=True, facecolor=(1, 1, 1, 0.16),
        edgecolor=(1, 1, 1, 0.75), linewidth=max(0.8, sc)))
    ax.add_patch(Polygon(
        [(0.45, 0.62), (0.47, 0.75), (0.53, 0.75), (0.55, 0.62)],
        closed=True, facecolor=(0.2, 0.3, 0.36, 0.65), edgecolor='none'))
    ax.add_patch(Polygon(
        [(0.50, 0.88), (0.47, 0.82), (0.53, 0.82)],
        closed=True, facecolor='white', edgecolor='none', alpha=0.85))

    wheels = {
        'FL': (0.31, 0.65), 'FR': (0.64, 0.65),
        'RL': (0.31, 0.24), 'RR': (0.64, 0.24),
    }
    for key, (x, y) in wheels.items():
        colour = positive if values[key] >= 0 else negative
        ax.add_patch(FancyBboxPatch(
            (x, y), 0.05, 0.13, boxstyle='round,pad=0.005',
            facecolor=colour, edgecolor='none', alpha=0.92))

    text_pos = {
        'FL': (0.08, 0.75, 'left'), 'FR': (0.92, 0.75, 'right'),
        'RL': (0.08, 0.32, 'left'), 'RR': (0.92, 0.32, 'right'),
    }
    for key, (x, y, align) in text_pos.items():
        colour = positive if values[key] >= 0 else negative
        ax.text(x, y + 0.075, key, ha=align, va='center',
                color=muted, fontsize=fs_label, fontweight='bold')
        value_text = ax.text(
            x, y, f'{values[key]:+.1f}', ha=align, va='center',
            color=colour, fontsize=fs_value, fontweight='bold')
        fit_text_to_width(fig, value_text, w * 0.25)
        ax.text(x, y - 0.070, 'N\u00b7m', ha=align, va='center',
                color=muted, fontsize=max(5, int(6 * sc)))

    return fig_to_rgba(fig, (w, h))
