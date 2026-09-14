/* Independent BLF channel / DBC binding page. */
(function () {
  let root = null;
  let project = {};
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const base = p => String(p || '').replace(/\\/g,'/').split('/').pop() || '未选择';
  const bindings = ch => {
    const v = project.dbc_bindings?.[String(ch)];
    return (Array.isArray(v) ? v : (v ? [v] : [])).filter(Boolean);
  };
  function html() { return `<div class="dbc-page">
    <header class="dbc-header"><div><div class="page-title">DBC 数据库配置</div>
      <div class="studio-subtitle">按 BLF 通道选择一个或多个 DBC，保存后返回 Studio 使用</div></div>
      <div class="top-actions"><button class="btn" id="dbc-back">返回 Studio</button><button class="btn btn-accent" id="dbc-save">保存配置</button></div></header>
    <section class="dbc-toolbar"><div class="dbc-file"><b>BLF 数据</b><span id="dbc-blf-name">${esc(base(project.blf_path))}</span></div>
      <button class="btn btn-sm" id="dbc-pick-blf">选择 BLF</button><button class="btn btn-ok" id="dbc-scan">扫描通道</button></section>
    <div class="dbc-status" id="dbc-status">就绪</div><section class="dbc-rows" id="dbc-rows"></section>
  </div>`; }
  function status(s) { const e=root?.querySelector('#dbc-status'); if(e)e.textContent=s; }
  async function save() { await API.saveStudioProject(project); status('配置已保存'); }
  function render() {
    const box=root?.querySelector('#dbc-rows'); if(!box)return;
    const channels=project.channels||[];
    if(!channels.length){box.innerHTML='<div class="dbc-empty">请先选择 BLF 并扫描通道</div>';return;}
    box.innerHTML=channels.map(ch=>{
      const paths=bindings(ch.channel);
      const chips=paths.length?paths.map((p,i)=>`<span class="dbc-chip" title="${esc(p)}">${esc(base(p))}<button data-remove="${ch.channel}" data-index="${i}" title="移除">×</button></span>`).join(''):'<span class="dbc-muted">未绑定 DBC</span>';
      return `<article class="dbc-row"><div class="dbc-channel"><strong>CH${ch.channel}</strong><small>${ch.frame_count||0} IDs · ${ch.message_count||0} 帧</small></div><div class="dbc-list">${chips}</div><button class="btn btn-sm" data-add="${ch.channel}">+ 添加 DBC</button></article>`;
    }).join('');
    box.querySelectorAll('[data-add]').forEach(btn=>btn.onclick=async()=>{
      const ch=btn.dataset.add, current=bindings(ch); const p=await API.openFileDialog(['DBC (*.dbc)'],current.at(-1)||project.blf_path).catch(()=>null);
      if(!p||current.includes(p))return; project.dbc_bindings={...(project.dbc_bindings||{}),[ch]:[...current,p]}; render(); await save();
    });
    box.querySelectorAll('[data-remove]').forEach(btn=>btn.onclick=async()=>{
      const ch=btn.dataset.remove, list=bindings(ch); list.splice(Number(btn.dataset.index),1); project.dbc_bindings={...(project.dbc_bindings||{}),[ch]:list}; render(); await save();
    });
  }
  async function scan() { if(!project.blf_path)return status('请先选择 BLF'); status('正在扫描 BLF 通道…'); project.channels=await API.studioScanBlfChannels(project.blf_path)||[]; render(); await save(); status(`已发现 ${project.channels.length} 个通道`); }
  async function pickBlf(){const p=await API.openFileDialog(['Vector BLF (*.blf)'],project.blf_path).catch(()=>null);if(!p)return;project.blf_path=p;project.channels=[];project.signals=[];project.dbc_bindings={};root.querySelector('#dbc-blf-name').textContent=base(p);await scan();}
  async function mount(el){root=el;project=await API.getStudioProject().catch(()=>({}));project.dbc_bindings=Object.fromEntries(Object.entries(project.dbc_bindings||{}).map(([k,v])=>[k,Array.isArray(v)?v.filter(Boolean):(v?[v]:[])]));root.innerHTML=html();render();root.querySelector('#dbc-back').onclick=async()=>{await save();Router.navigate('studio')};root.querySelector('#dbc-save').onclick=save;root.querySelector('#dbc-pick-blf').onclick=pickBlf;root.querySelector('#dbc-scan').onclick=scan;}
  function unmount(){root=null;}
  Router.register('dbc',{mount,unmount});
})();
