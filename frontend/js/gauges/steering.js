/** Steering wheel model with signed angle readout. */
const GaugeSteering = (() => {
  function render(ctx,data,w,h){
    const T=GaugeBase.getTheme(data.theme||data._theme||'Dark');
    GaugeBase.drawBackground(ctx,w,h,T);
    const v=Number(data.value||0), sc=Math.min(w/180,h/150);
    ctx.save();ctx.textAlign='center';
    ctx.fillStyle=T.label;ctx.font=`bold ${Math.max(8,11*sc)}px 'Segoe UI'`;ctx.fillText('STEERING',w*.5,h*.13);
    const cx=w*.5,cy=h*.48,r=Math.min(w,h)*.25;
    ctx.translate(cx,cy);ctx.rotate(v*Math.PI/180);
    ctx.strokeStyle='#dbe7f4';ctx.lineWidth=Math.max(3,r*.13);
    ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
    ctx.lineCap='round';ctx.lineWidth=Math.max(3,r*.11);
    [[0,-r*.2,0,-r*.88],[-r*.12,r*.08,-r*.72,r*.62],[r*.12,r*.08,r*.72,r*.62]].forEach(a=>{ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(a[2],a[3]);ctx.stroke()});
    ctx.fillStyle='#172333';ctx.beginPath();ctx.arc(0,0,r*.25,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#38cfff';ctx.lineWidth=2;ctx.stroke();
    ctx.restore();
    ctx.fillStyle=T.text;ctx.font=`bold ${Math.max(13,22*sc)}px 'Segoe UI'`;ctx.fillText((v>=0?'+':'')+v.toFixed(1)+'°',w*.5,h*.86);
    ctx.fillStyle=T.label;ctx.font=`${Math.max(7,8*sc)}px 'Segoe UI'`;ctx.fillText('L  +   /   −  R',w*.5,h*.96);
  }
  return {render};
})();
