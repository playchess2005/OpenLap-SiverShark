(function () {
  let root = null;
  let project = {};
  let offScanProgress = null;
  let offScanDone = null;
  const colors = ['#00d4ff','#66dd44','#f0b44d','#c084fc','#ff6b9d','#7dd3fc','#f97316','#a3e635'];
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const base = p => String(p || '').replace(/\\/g,'/').split('/').pop() || '未选择';
  const signalInfo = key => (project.signals || []).find(s => s.key === key);
  const trackKey = signal => 'track-' + String(signal || '').split('').reduce((h,c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);
  function normalize() {
    const legacy = project.track_signals && typeof project.track_signals === 'object' ? project.track_signals : {};
    const configs = Array.isArray(project.track_configs) ? project.track_configs.slice() : [];
    Object.entries(legacy).forEach(([key, signal]) => {
      if (signal && !configs.some(t => t.signal === signal)) configs.push({key, signal, label: signalInfo(signal)?.label || '轨迹'});
    });
    project.track_configs = configs.map((t, i) => ({key: String(t.key || trackKey(t.signal)), signal: t.signal || '', label: String(t.label || signalInfo(t.signal)?.label || '轨迹'), color: t.color || colors[i % colors.length]}));
    project.track_signals = {};
    project.track_configs.forEach(t => { if (t.signal) project.track_signals[t.key] = t.signal; });
  }
  function status(message) { const e = root?.querySelector('#signals-status'); if (e) e.textContent = message; }
  function fmtWait(seconds) {
    const value = Math.max(0, Number(seconds) || 0); if (value < 60) return Math.ceil(value) + ' 秒';
    return Math.floor(value / 60) + ' 分 ' + Math.ceil(value % 60) + ' 秒';
  }
  function setSignalProgress(e = {}) {
    const card = root?.querySelector('#signals-progress-card'), bar = root?.querySelector('#signals-progress');
    const percentEl = root?.querySelector('#signals-progress-percent'), label = root?.querySelector('#signals-progress-label');
    if (!card || !bar || !percentEl || !label) return;
    const percent = Math.max(0, Math.min(100, Number(e.percent) || 0)); card.hidden = false;
    card.classList.toggle('is-done', percent >= 100 && !e.failed); card.classList.toggle('is-failed', !!e.failed);
    bar.classList.toggle('indeterminate', Number(e.percent) < 0); if (Number(e.percent) >= 0) bar.style.width = percent + '%';
    percentEl.textContent = percent.toFixed(percent > 0 && percent < 10 ? 1 : 0) + '%';
    const frames = Number(e.frames || 0), elapsed = Number(e.elapsed_s || 0), eta = Number(e.eta_s), parts = [];
    if (frames) parts.push(frames.toLocaleString() + ' 帧'); if (elapsed) parts.push('已用 ' + fmtWait(elapsed));
    if (Number.isFinite(eta) && eta > 0 && percent < 100) parts.push('预计还需 ' + fmtWait(eta));
    if (e.cached) parts.push('已从缓存加载'); if (e.result) parts.push(e.result); else if (percent >= 100 && !e.failed) parts.push('扫描完成');
    label.textContent = parts.join(' · ') || e.message || '准备扫描…';
  }
  async function save() { normalize(); await API.saveStudioProject(project); }
  function signalText(s) { return 'CH' + s.channel + ' · ' + s.label + (s.unit ? ' [' + s.unit + ']' : ''); }
  function render() {
    normalize();
    const box = root?.querySelector('#signals-list'); if (!box) return;
    const selected = new Set(project.track_configs.filter(t => t.signal).map(t => t.signal));
    const rows = (project.signals || []).map(s => {
      const text = signalText(s);
      return '<label class="signal-row" data-signal-search="' + esc([text,s.key,s.message,s.signal,s.frame_hex,s.source].join(' ').toLowerCase()) + '"><input type="checkbox" data-signal-key="' + esc(s.key) + '"' + (selected.has(s.key) ? ' checked' : '') + '><span class="signal-main"><strong>' + esc(text) + '</strong><small>Message: ' + esc(s.message || '') + ' · Signal: ' + esc(s.signal || '') + ' · ' + esc(s.frame_hex || '') + '</small></span><span class="signal-source">' + esc(base(s.dbc_path)) + '</span></label>';
    }).join('');
    box.innerHTML = rows || '<div class="signal-empty">暂无可用 Signal。请先在 DBC 页面绑定数据库，再返回这里扫描。</div>';
    root.querySelector('#signals-count').textContent = String(project.signals?.length || 0);
    root.querySelector('#signals-selected').textContent = String(selected.size);
    box.querySelectorAll('[data-signal-key]').forEach(input => input.onchange = async () => {
      const key = input.dataset.signalKey;
      if (input.checked && !project.track_configs.some(t => t.signal === key)) {
        const info = signalInfo(key);
        project.track_configs.push({key: trackKey(key), signal: key, label: info?.label || '轨迹', color: colors[project.track_configs.length % colors.length]});
      } else if (!input.checked) {
        project.track_configs = project.track_configs.filter(t => t.signal !== key);
        Object.keys(project.track_signals || {}).forEach(trackKey => { if (project.track_signals[trackKey] === key) delete project.track_signals[trackKey]; });
      }
      await save(); render(); filter(); status(input.checked ? '已加入轨迹' : '已移除轨迹');
    });
  }
  function filter() {
    const q = root.querySelector('#signals-search').value.trim().toLowerCase();
    root.querySelectorAll('.signal-row').forEach(row => { row.hidden = !!q && !(row.dataset.signalSearch || '').includes(q); });
    root.querySelector('#signals-visible').textContent = String([...root.querySelectorAll('.signal-row')].filter(row => !row.hidden).length);
  }
  async function scan() {
    if (!project.blf_path) return status('请先在 DBC 页面选择 BLF');
    const hasBindings = Object.values(project.dbc_bindings || {}).some(v => Array.isArray(v) ? v.length : !!v);
    if (!hasBindings) return status('请先在 DBC 页面为 BLF 通道添加 DBC');
    status('正在启动 BLF 扫描…'); setSignalProgress({percent:0, frames:0, message:'准备扫描…'});
    try { await API.studioStartCatalogScan(project.blf_path, project.dbc_bindings || {}); }
    catch (e) { status('扫描启动失败：' + e); }
  }
  async function applyCatalog(catalog) {
    project.channels = catalog.channels || project.channels || [];
    project.signals = catalog.signals || [];
    await save(); render(); filter();
  }
  async function mount(el) {
    root = el; project = await API.getStudioProject().catch(() => ({}));
    project.dbc_bindings = project.dbc_bindings || {}; project.signals = project.signals || [];
    normalize();
    root.innerHTML = '<div class="signals-page"><header class="signals-header"><div><div class="page-title">Signal 轨迹选择</div><div class="studio-subtitle">从 BLF + DBC 扫描结果中选择要显示的轨迹</div></div><div class="top-actions"><button class="btn" id="signals-back">返回 Studio</button><button class="btn btn-ok" id="signals-scan">重新扫描 Signal</button><button class="btn btn-accent" id="signals-save">保存并返回 Studio</button></div></header><section class="signals-toolbar"><div><strong>BLF：</strong>' + esc(base(project.blf_path)) + '</div><div><strong>候选：</strong><b id="signals-count">0</b> · <strong>当前选择：</strong><b id="signals-selected">0</b> · <strong>当前显示：</strong><b id="signals-visible">0</b></div><input id="signals-search" type="search" placeholder="可选过滤：Message、Signal、CAN ID、DBC 文件名"><button class="btn btn-sm" id="signals-clear">清空过滤</button></section><div class="signals-hint"><div id="signals-status">每行一个 Signal，勾选后会加入 Studio 轨迹；轨迹名称可返回 Studio 后修改。</div><div class="signals-progress-card" id="signals-progress-card" hidden><div class="signals-progress-head"><span>Signal 目录扫描</span><b id="signals-progress-percent">0%</b></div><div class="signals-progress-wrap"><div id="signals-progress" class="signals-progress"></div></div><div class="signals-progress-label" id="signals-progress-label">准备扫描…</div></div></div><main class="signals-list" id="signals-list"></main></div>';
    render(); filter();
    offScanProgress = API.on('studio-scan-progress', e => {
      const count = Number(e.frames || 0);
      status(e.message || (count ? ('已扫描 ' + count.toLocaleString() + ' 帧…') : '正在扫描 BLF…')); const bar = root?.querySelector('#signals-progress'); if (bar) { bar.classList.toggle('indeterminate', Number(e.percent) < 0); if (Number(e.percent) >= 0) bar.style.width = Math.max(0, Math.min(100, Number(e.percent))) + '%'; }
    });
    offScanDone = API.on('studio-scan-done', async e => {
      if (!e.ok) { setSignalProgress({percent:0, failed:true, message:'扫描失败'}); return status('扫描失败：' + (e.error || '未知错误')); }
      await applyCatalog(e.catalog || {});
      status('扫描完成：' + (project.signals || []).length + ' 个 Signal');
    });
    root.querySelector('#signals-search').oninput = filter;
    root.querySelector('#signals-clear').onclick = () => { root.querySelector('#signals-search').value = ''; filter(); };
    root.querySelector('#signals-scan').onclick = scan;
    root.querySelector('#signals-save').onclick = async () => { await save(); Router.navigate('studio'); };
    root.querySelector('#signals-back').onclick = async () => { await save(); Router.navigate('studio'); };
    if (!project.signals.length && Object.values(project.dbc_bindings).some(v => Array.isArray(v) ? v.length : !!v)) await scan();
  }
  function unmount() { if (offScanProgress) offScanProgress(); if (offScanDone) offScanDone(); offScanProgress = offScanDone = null; root = null; }
  Router.register('signals', {mount, unmount});
})();
