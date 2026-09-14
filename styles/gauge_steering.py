STYLE_NAME = 'Steering'
ELEMENT_TYPE = 'gauge'

import math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Circle
from overlay_utils import fig_to_rgba, scale_factor

def render(data: dict, w: int, h: int):
    value=float(data.get('value',0.0)); T=data.get('_tc',{})
    bg=T.get('bg_rgba',(0,0,0,.72)); edge=T.get('bg_edge_rgba',(1,1,1,.07))
    text=T.get('text','white'); label=T.get('label','#8fa4b8')
    sc=scale_factor(w,h,base_w=180,base_h=150)
    fig=plt.figure(figsize=(w/100,h/100),dpi=100);fig.patch.set_alpha(0)
    ax=fig.add_axes([0,0,1,1]);ax.set_xlim(0,1);ax.set_ylim(0,1);ax.set_aspect('equal');ax.axis('off')
    ax.add_patch(FancyBboxPatch((.02,.02),.96,.96,boxstyle='round,pad=.025',
        facecolor=bg,edgecolor=edge,linewidth=.8))
    ax.text(.5,.89,'STEERING',ha='center',va='center',color=label,
        fontsize=max(7,int(11*sc)),fontweight='bold')
    cx,cy,r=.5,.55,.235
    ax.add_patch(Circle((cx,cy),r,fill=False,edgecolor='#dbe7f4',linewidth=max(2,3.5*sc)))
    a=math.radians(value)
    def rot(x,y):
        return cx+x*math.cos(a)-y*math.sin(a),cy+x*math.sin(a)+y*math.cos(a)
    for x1,y1,x2,y2 in ((0,-.04,0,r*.86),(-.025,.015,-r*.68,-r*.58),(.025,.015,r*.68,-r*.58)):
        p1,p2=rot(x1,y1),rot(x2,y2)
        ax.plot([p1[0],p2[0]],[p1[1],p2[1]],color='#dbe7f4',linewidth=max(2,3*sc),solid_capstyle='round')
    ax.add_patch(Circle((cx,cy),r*.25,facecolor='#172333',edgecolor='#38cfff',linewidth=max(1,1.4*sc)))
    ax.text(.5,.20,f'{value:+.1f}°',ha='center',va='center',color=text,
        fontsize=max(12,int(21*sc)),fontweight='bold')
    ax.text(.5,.075,'L  +   /   −  R',ha='center',va='center',color=label,fontsize=max(5,int(7*sc)))
    return fig_to_rgba(fig,(w,h))
