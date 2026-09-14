/**
 * Studio — video/BLF material selection and manual multi-track alignment.
 * Uses the official OpenLap WebView/Canvas stack and shares its Overlay editor.
 */
(function () {
  let root = null, video = null, canvas = null, ctx = null, probe = null;
  let raf = null, videoPort = 0, exporting = false;
  let exportProgress = 0;
  let unlisten = [], mountGen = 0, lastVideoTime = 0, loadedMediaKey = '';
  let resizeObserver = null;
  let activeTrack = 'steering';
  let project = {
    video_path: '', blf_path: '', output_path: '',
    global_offset_s: 0, steering_offset_s: 0, yaw_offset_s: 0,
    start_s: 0, end_s: 0, workers: 8,
    dbc_bindings: {}, channels: [], signals: [], track_signals: {}, track_configs: [],
  };
  const tracks = [
    {key:'rpm', label:'四轮转速', icon:'◉', color:'#00d4ff'},
    {key:'throttle', label:'油门', icon:'▰', color:'#66dd44'},
    {key:'steering', label:'方向盘', icon:'◌', color:'#f0b44d'},
    {key:'yaw', label:'横摆角速度', icon:'↻', color:'#c084fc'},
  ];
  const trackColors = tracks.map(t => t.color);
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const base = p => (p || '').replace(/\\/g,'/').split('/').pop() || '未选择';
  const fmt = s => {
    s = Math.max(0, Number(s) || 0);
    const m = Math.floor(s / 60), sec = (s % 60).toFixed(2).padStart(5,'0');
    return m + ':' + sec;
  };
  function hashKey(value) {
    let hash = 2166136261;
    for (const ch of String(value || '')) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }
  function signalInfo(key) { return (project.signals || []).find(s => s.key === key); }
  function newTrackKey(signal) {
    if (signal) return `track-${hashKey(signal)}`;
    // Track configs without a signal are legacy/partial entries. Give them
    // a persisted UUID when normalized; never derive identity from position.
    return `track-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  }
  function syncTrackSignals() {
    project.track_signals = {};
    (project.track_configs || []).forEach(t => { if (t.signal) project.track_signals[t.key] = t.signal; });
  }
  function normalizeTrackConfigs() {
    let configs = Array.isArray(project.track_configs) ? project.track_configs.slice() : [];
    const legacy = project.track_signals && typeof project.track_signals === 'object' ? project.track_signals : {};
    const known = new Set(configs.map(t => String(t.key || '')));
    Object.entries(legacy).forEach(([legacyKey, signal], index) => {
      if (!signal || configs.some(t => t.signal === signal)) return;
      const old = tracks.find(t => t.key === legacyKey);
      const info = signalInfo(signal);
      configs.push({key: String(legacyKey || newTrackKey(signal, index)),
        label: old?.label || info?.label || '轨迹', color: old?.color || trackColors[index % trackColors.length], signal});
    });
    project.track_configs = configs.map((t, index) => ({
      key: String(t.key || newTrackKey(t.signal, index)),
      label: String(t.label || signalInfo(t.signal)?.label || '轨迹'),
      color: t.color || trackColors[index % trackColors.length], signal: t.signal || ''
    }));
    syncTrackSignals();
    return project.track_configs;
  }
  const videoUrl = p => videoPort
    ? `http://127.0.0.1:${videoPort}/?f=${encodeURIComponent(p)}`
    : 'file:///' + p.replace(/\\/g,'/');

  function html() {
    return `
      <div class="studio-shell">
        <header class="studio-topbar">
          <div><div class="page-title">OpenLap Studio</div>
            <div class="studio-subtitle">视频与 BLF 多轨手动对齐工作区</div></div>
          <div class="studio-top-actions">
            <button class="btn" id="st-save">保存工程</button>
            <button class="btn" id="st-overlay">下一步：编辑 Overlay</button>
            <button class="btn btn-accent" id="st-export">导出视频</button>
          </div>
        </header>
        <div class="studio-steps"><b>1 选择素材</b><span>›</span><b>2 绑定 DBC / 选择轨迹</b><span>›</span><b>3 标定偏移</b><span>›</span><b>4 添加卡片并导出</b></div>
        <div class="studio-workspace">
          <aside class="studio-toolrail">
            <div class="studio-rail-title">工具</div>
            ${tracks.map(t => `<button class="studio-tool ${t.key===activeTrack?'active':''}"
              data-track="${t.key}" title="${t.label}"><b>${t.icon}</b><span>${t.label}</span></button>`).join('')}
            <div class="studio-rail-sep"></div>
            <button class="studio-tool" data-gauge="Steering"><b>◉</b><span>方向盘模型</span></button>
            <button class="studio-tool" data-gauge="Pedals"><b>▱</b><span>踏板曲线</span></button>
            <button class="studio-tool" data-gauge="Wheel Torque"><b>▦</b><span>四轮扭矩</span></button>
            <button class="studio-tool" data-gauge="Yaw"><b>↻</b><span>横摆角速度</span></button>
          </aside>
          <section class="studio-center">
            <div class="studio-assets">
              <div class="studio-asset"><span class="asset-icon">🎞</span>
                <div><strong>视频</strong><small id="st-video-name">${esc(base(project.video_path))}</small></div>
                <button class="btn btn-sm" id="st-pick-video">选择</button></div>
              <div class="studio-asset"><span class="asset-icon">📈</span>
                <div><strong>BLF 数据</strong><small id="st-blf-name">${esc(base(project.blf_path))}</small></div>
                <button class="btn btn-sm" id="st-pick-blf">选择</button></div>
              <button class="btn btn-ok" id="st-load">载入素材</button>
            </div>
            <div class="studio-dbc-summary" id="st-dbc-summary"><span>DBC：未配置</span><button class="btn btn-sm" id="st-config-dbc">配置数据库</button></div>
            <div class="studio-bindings" id="st-bindings" style="display:none">
              <div class="studio-binding-head"><strong>BLF \u901a\u9053 / DBC \u6570\u636e\u5e93</strong><span>\u6bcf\u4e2a\u901a\u9053\u53ef\u6dfb\u52a0\u591a\u4e2a DBC\uff0c\u6309\u5217\u8868\u987a\u5e8f\u89e3\u7801</span></div>
              <div id="st-binding-rows"><span class="studio-muted">\u9009\u62e9 BLF \u540e\u626b\u63cf\u901a\u9053</span></div>
            </div>
            <div class="studio-viewer">
              <video id="st-video" preload="metadata"></video>
              <div class="studio-viewer-empty" id="st-empty">选择 MP4 与 BLF 后载入</div>
            </div>
            <div class="studio-transport">
              <button id="st-play">▶</button>
              <span id="st-clock">0:00.00 / 0:00.00</span>
              <input id="st-scrub" type="range" min="0" max="1" step=".001" value="0">
            </div>
            <div class="studio-track-manager" id="st-track-manager">
              <div class="studio-track-manager-head"><strong>轨迹曲线</strong><button class="btn btn-sm" id="st-toggle-tracks">展开选择 Signal</button></div>
              <div class="studio-track-manager-body" id="st-track-manager-body" style="display:none"></div>
            </div>
            <div class="studio-timeline">
              <canvas id="st-timeline"></canvas>
              <div class="studio-track-legend" id="st-track-legend"></div>
            </div>
          </section>
          <aside class="studio-inspector">
            <h3>对齐参数</h3>
            <label>全局 BLF 偏移 <span>视频 t → BLF t</span></label>
            <div class="studio-number"><button data-nudge="-1">−1</button><button data-nudge="-.1">−0.1</button>
              <input id="st-global" type="number" step=".001" value="${project.global_offset_s}">
              <button data-nudge=".1">+0.1</button><button data-nudge="1">+1</button></div>
            <label>方向盘独立提前 <span>秒</span></label>
            <input id="st-steer" type="number" step=".05" value="${project.steering_offset_s}">
            <label>横摆角速度独立提前 <span>秒</span></label>
            <input id="st-yaw" type="number" step=".05" value="${project.yaw_offset_s}">
            <div class="studio-hint">正值表示该信号在视频里更早出现。点击下方波形可定位视频时间。</div>
            <h3>导出区间</h3>
            <div class="studio-row"><label>开始<input id="st-start" type="number" step=".1" value="${project.start_s}"></label>
              <label>结束<input id="st-end" type="number" step=".1" value="${project.end_s}"></label></div>
            <label>输出文件</label>
            <div class="studio-path"><input id="st-output" value="${esc(project.output_path)}"><button id="st-pick-output">…</button></div>
            <button class="btn btn-accent studio-next" id="st-next-overlay">保存对齐并进入 Overlay 添加卡片</button>
            <div class="studio-progress" id="st-progress-wrap"><div id="st-progress-bar"></div></div>
            <div id="st-progress-label" class="studio-progress-label">导出进度：未开始</div>
            <div id="st-status">就绪</div>
            <details id="st-export-details" class="studio-export-details" hidden>
              <summary>查看导出详情</summary>
              <pre id="st-export-logs"></pre>
            </details>
          </aside>
        </div>
      </div>`;
  }

  function readControls() {
    const n = id => Number(root.querySelector(id)?.value || 0);
    project.global_offset_s = n('#st-global');
    project.steering_offset_s = n('#st-steer');
    project.yaw_offset_s = n('#st-yaw');
    project.start_s = n('#st-start');
    project.end_s = n('#st-end');
    project.output_path = root.querySelector('#st-output')?.value || '';
  }
  function setStatus(s) { const el=root?.querySelector('#st-status'); if(el) el.textContent=s; }
  function setExportLogs(logs) {
    const details=root?.querySelector('#st-export-details'), out=root?.querySelector('#st-export-logs');
    if(!details||!out)return;
    const lines=Array.isArray(logs)?logs:logs==null?[]:String(logs).split(/\r?\n/);
    out.textContent=lines.filter(Boolean).join('\n'); details.hidden=!out.textContent;
  }
  function setExportProgress(percent, stage, message) {
    const wrap=root?.querySelector('#st-progress-wrap'), bar=root?.querySelector('#st-progress-bar'), label=root?.querySelector('#st-progress-label');
    if(!wrap||!bar||!label)return;
    const numeric=Number(percent), known=Number.isFinite(numeric)&&numeric>=0;
    if(known) exportProgress=Math.max(0,Math.min(100,numeric));
    const terminal=['failed','cancelled','done'].includes(stage);
    wrap.classList.toggle('indeterminate', !known && exporting && !terminal);
    wrap.classList.toggle('is-success', stage==='done'); wrap.classList.toggle('is-failed', stage==='failed');
    wrap.classList.toggle('is-cancelled', stage==='cancelled');
    bar.style.width=known||terminal?exportProgress+'%':(exporting?'100%':exportProgress+'%');
    const stageText=({starting:'启动中',preparing:'准备中',encoding:'编码中',finalizing:'收尾中',failed:'失败',done:'完成',cancelled:'已取消'}[stage]||'处理中');
    label.textContent=known?`导出进度：${exportProgress.toFixed(1)}% · ${stageText}`:`导出进度：${stageText}…`; if(message)setStatus(message);
  }
  async function save() { readControls(); await API.saveStudioProject(project); setStatus('工程已保存'); }


  function bindingList(channel) {
    const value = project.dbc_bindings?.[String(channel)];
    return (Array.isArray(value) ? value : (value ? [value] : [])).filter(Boolean);
  }

  async function refreshCatalog() {
    const catalog = await API.studioCatalogSignals(project.blf_path, project.dbc_bindings || {}).catch(e => {
      setStatus('\u52a0\u8f7d DBC \u5931\u8d25\uff1a' + e); return null;
    });
    if (!catalog) return false;
    project.channels = catalog.channels || project.channels;
    project.signals = catalog.signals || [];
    const available = new Set(project.signals.map(s => s.key));
    normalizeTrackConfigs();
    project.track_configs = project.track_configs.filter(t => !t.signal || available.has(t.signal));
    syncTrackSignals();
    const suffix = catalog.conflicts?.length
      ? '\uff1b' + catalog.conflicts.length + '\u4e2a CAN ID \u51b2\u7a81\uff0c\u5df2\u6309 DBC \u5217\u8868\u4e2d\u7b2c\u4e00\u4e2a\u89e3\u7801'
      : '';
    setStatus('\u5df2\u52a0\u8f7d ' + project.signals.length + ' \u4e2a\u53ef\u7528 Message.Signal' + suffix);
    renderTrackPickers();
    return true;
  }

  function renderTrackPickers() {
    const box = root?.querySelector('#st-track-manager-body');
    if (!box) return;
    const configs = normalizeTrackConfigs();
    const selected = new Set(configs.filter(t => t.signal).map(t => t.signal));
    const options = (project.signals || []).map(s => {
      const text = 'CH' + s.channel + ' · ' + s.label + (s.unit ? ' [' + s.unit + ']' : '');
      return '<label class="studio-signal-option" data-signal-text="' + esc(text.toLowerCase()) + '"><input type="checkbox" data-track-signal="' + esc(s.key) + '"' + (selected.has(s.key) ? ' checked' : '') + '><span>' + esc(text) + '</span></label>';
    }).join('');
    const chosen = configs.filter(t => t.signal).map(t => {
      const info = signalInfo(t.signal);
      return '<div class="studio-track-config" data-track-config="' + esc(t.key) + '"><input data-track-label-key="' + esc(t.key) + '" value="' + esc(t.label || '') + '" placeholder="轨迹名称"><span class="studio-track-signal" title="' + esc(t.signal) + '">' + esc(info?.label || t.signal) + '</span><button class="btn btn-sm" data-track-remove-key="' + esc(t.key) + '">删除</button></div>';
    }).join('');
    box.innerHTML = '<input class="studio-track-search" data-track-search type="search" placeholder="搜索 Signal…"><div class="studio-signal-options" data-track-options>' + (options || '<span class="studio-muted">载入 BLF 和 DBC 后可选择 Signal</span>') + '</div><div class="studio-track-selected"><div class="studio-track-selected-title">已选择轨迹</div>' + (chosen || '<span class="studio-muted">尚未选择轨迹</span>') + '</div>';
    const search = box.querySelector('[data-track-search]');
    if (search) search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      box.querySelectorAll('.studio-signal-option').forEach(row => { row.style.display = !q || row.dataset.signalText.includes(q) ? '' : 'none'; });
    };
    box.querySelectorAll('[data-track-signal]').forEach(input => input.onchange = async () => {
      const signal = input.dataset.trackSignal;
      if (input.checked) {
        if (!project.track_configs.some(t => t.signal === signal)) {
          const info = signalInfo(signal);
          project.track_configs.push({key: newTrackKey(signal, project.track_configs.length), label: info?.label || '轨迹', color: trackColors[project.track_configs.length % trackColors.length], signal});
        }
      } else {
        project.track_configs = project.track_configs.filter(t => t.signal !== signal);
      }
      syncTrackSignals(); loadedMediaKey = ''; await save(); renderTrackPickers(); renderTrackLegend(); await load();
    });
    box.querySelectorAll('[data-track-label-key]').forEach(input => input.onchange = async () => {
      const config = project.track_configs.find(t => t.key === input.dataset.trackLabelKey);
      if (config) config.label = input.value || '轨迹';
      syncTrackSignals(); await save(); renderTrackLegend();
    });
    box.querySelectorAll('[data-track-remove-key]').forEach(button => button.onclick = async () => {
      project.track_configs = project.track_configs.filter(t => t.key !== button.dataset.trackRemoveKey);
      syncTrackSignals(); loadedMediaKey = ''; await save(); renderTrackPickers(); renderTrackLegend(); await load();
    });
    renderTrackLegend();
  }
  function renderTrackLegend() {
    const box = root?.querySelector('#st-track-legend'); if (!box) return;
    box.innerHTML = (project.track_configs || []).map(t => '<span style="color:' + esc(t.color || '#60a5fa') + '">' + esc(t.label || '轨迹') + '</span>').join('');
  }
  function renderDbcSummary() {
    const box = root?.querySelector('#st-dbc-summary'); if (!box) return;
    const count = Object.values(project.dbc_bindings || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : (v ? 1 : 0)), 0);
    box.querySelector('span').textContent = 'DBC：' + (count ? count + ' 个已配置' : '未配置');
  }

  function renderBindings() {
    const box = root?.querySelector('#st-binding-rows');
    if (!box) return;
    const channels = project.channels || [];
    if (!channels.length) {
      box.innerHTML = '<span class="studio-muted">\u9009\u62e9 BLF \u540e\u626b\u63cf\u901a\u9053</span>';
      return;
    }
    box.innerHTML = channels.map(ch => {
      const paths = bindingList(ch.channel);
      const chips = paths.length ? paths.map((path, index) =>
        '<span class="studio-dbc-chip" title="' + esc(path) + '">' + esc(base(path)) +
        '<button title="\u79fb\u9664" data-remove-channel="' + ch.channel + '" data-remove-index="' + index + '">\u00d7</button></span>'
      ).join('') : '<span class="studio-muted">\u672a\u7ed1\u5b9a DBC</span>';
      return '<div class="studio-binding-row"><span class="studio-channel">CH' + ch.channel + '<small>' +
        ch.frame_count + ' IDs / ' + ch.message_count + ' \u5e27</small></span>' +
        '<span class="studio-dbc-list">' + chips + '</span>' +
        '<button class="btn btn-sm" data-bind-channel="' + ch.channel + '">+ \u6dfb\u52a0 DBC</button></div>';
    }).join('');
    box.querySelectorAll('[data-bind-channel]').forEach(btn => btn.onclick = async () => {
      const ch = btn.dataset.bindChannel;
      const current = bindingList(ch);
      const path = await API.openFileDialog(['DBC (*.dbc)'], current.at(-1) || project.blf_path).catch(() => null);
      if (!path || current.includes(path)) return;
      project.dbc_bindings = {...(project.dbc_bindings || {}), [ch]: [...current, path]};
      loadedMediaKey = '';
      renderBindings();
      setStatus('\u6b63\u5728\u5339\u914d CH' + ch + ' \u4e2d\u5b9e\u9645\u51fa\u73b0\u7684\u4fe1\u53f7\u2026');
      await refreshCatalog();
      await save();
    });
    box.querySelectorAll('[data-remove-channel]').forEach(btn => btn.onclick = async () => {
      const ch = btn.dataset.removeChannel;
      const paths = bindingList(ch);
      paths.splice(Number(btn.dataset.removeIndex), 1);
      project.dbc_bindings = {...(project.dbc_bindings || {}), [ch]: paths};
      loadedMediaKey = '';
      renderBindings();
      await refreshCatalog();
      await save();
    });
  }

  async function scanChannels(expectedGen = mountGen) {
    if (!project.blf_path) return;
    setStatus('\u6b63\u5728\u626b\u63cf BLF \u901a\u9053\u4e0e CAN ID\u2026');
    const channels = await API.studioScanBlfChannels(project.blf_path) || [];
    if (expectedGen !== mountGen || !root?.isConnected) return;
    project.channels = channels;
    project.signals = [];
    renderBindings();
    renderTrackPickers();
    await save();
    setStatus('\u5df2\u53d1\u73b0 ' + project.channels.length + ' \u4e2a BLF \u901a\u9053\uff0c\u8bf7\u9010\u901a\u9053\u6dfb\u52a0 DBC');
  }

  async function pick(kind) {
    const filters = kind === 'video'
      ? ['Video (*.mp4;*.mov;*.m4v;*.avi;*.mkv)']
      : ['Vector BLF (*.blf)'];
    const current = kind === 'video' ? project.video_path : project.blf_path;
    const path = await API.openFileDialog(filters, current).catch(()=>null);
    if (!path) return;
    project[kind + '_path'] = path;
    if (kind === 'blf' && path !== current) {
      project.dbc_bindings = {}; project.channels = []; project.signals = [];
      project.track_signals = {}; probe = null; loadedMediaKey = '';
    }
    if (kind === 'video' && path !== current) {
      probe = null; loadedMediaKey = ''; lastVideoTime = 0;
    }
    root.querySelector(kind === 'video' ? '#st-video-name' : '#st-blf-name').textContent = base(path);
    if (kind === 'video' && !project.output_path) {
      project.output_path = path.replace(/\.[^.]+$/, '_openlap.mp4');
      root.querySelector('#st-output').value = project.output_path;
    }
    await save();
    if (kind === 'blf') await scanChannels();
  }

  function mediaKey() {
    return JSON.stringify([project.video_path, project.blf_path, project.dbc_bindings || {}, project.track_signals || {}]);
  }

  async function showVideo(expectedGen = mountGen) {
    if (!project.video_path || !video) return false;
    const port = await (API.studioPrepareVideo
      ? API.studioPrepareVideo(project.video_path)
      : API.getVideoServerPort()).catch(() => 0);
    if (expectedGen !== mountGen || !root?.isConnected || !video) return false;
    videoPort = port;
    const src = videoUrl(project.video_path);
    if (video.src !== src) video.src = src;
    video.style.display = 'block';
    const empty = root.querySelector('#st-empty');
    if (empty) empty.style.display = 'none';
    const restore = () => {
      if (lastVideoTime > 0 && Number.isFinite(video.duration))
        video.currentTime = Math.min(lastVideoTime, Math.max(0, video.duration - .05));
    };
    if (video.readyState >= 1) restore(); else video.addEventListener('loadedmetadata', restore, {once:true});
    return true;
  }

  async function load() {
    readControls();
    normalizeTrackConfigs();
    if (!project.video_path || !project.blf_path) return setStatus('请先选择视频和 BLF');
    const expectedGen = mountGen;
    await showVideo(expectedGen);
    if (expectedGen !== mountGen || !root?.isConnected) return;
    setStatus('正在读取 BLF 波形…（视频可继续预览）');
    const button = root.querySelector('#st-load');
    if (button) button.disabled = true;
    try {
      const nextProbe = await API.studioProbe(
        project.video_path, project.blf_path, project.dbc_bindings || {}, project.track_signals || {}
      );
      if (expectedGen !== mountGen || !root?.isConnected) return;
      probe = nextProbe;
      loadedMediaKey = mediaKey();
      project.channels = probe.channels || project.channels || [];
      project.signals = probe.signals || [];
      project.dbc_bindings = probe.dbc_bindings || project.dbc_bindings || {};
      renderBindings();
      renderDbcSummary();
      renderTrackPickers();
      root.querySelector('#st-scrub').max = probe.video.duration || 1;
      if (!project.end_s || project.end_s > probe.video.duration) {
        project.end_s = Math.floor(probe.video.duration * 10) / 10;
        root.querySelector('#st-end').value = project.end_s;
      }
      const conflicts = probe.conflicts?.length ? ' · ' + probe.conflicts.length + ' 个 DBC ID 冲突' : '';
      setStatus(`${probe.video.width}×${probe.video.height} · ${probe.video.fps.toFixed(2)} fps · BLF ${fmt(probe.blf.duration)}${conflicts}`);
      resizeCanvas(); draw();
      await save();
    } catch (e) {
      if (expectedGen === mountGen) setStatus('载入失败：' + e);
    } finally {
      if (expectedGen === mountGen && root?.isConnected) {
        const currentButton = root.querySelector('#st-load');
        if (currentButton) currentButton.disabled = false;
      }
    }
  }

  function trackOffset(key) {
    if (key === 'steering') return project.steering_offset_s;
    if (key === 'yaw') return project.yaw_offset_s;
    return 0;
  }
  function resizeCanvas() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width*dpr)); canvas.height=Math.max(1,Math.round(r.height*dpr));
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function draw() {
    if (!ctx || !canvas) return;
    const w=canvas.clientWidth,h=canvas.clientHeight;
    ctx.clearRect(0,0,w,h); ctx.fillStyle='#0a0d15';ctx.fillRect(0,0,w,h);
    const activeTracks = (project.track_configs || []).filter(t => t.signal);
    const duration = probe?.video?.duration || 1, rowH=h/Math.max(1, activeTracks.length);
    activeTracks.forEach((t,i)=>{
      const y=i*rowH;
      ctx.fillStyle=i%2?'#0e121c':'#101522';ctx.fillRect(0,y,w,rowH-1);
      ctx.fillStyle=t.color || '#60a5fa';ctx.font='12px Segoe UI';ctx.fillText(t.label || '轨迹',10,y+17);
      const pts=probe?.traces?.[t.key] || []; if(!pts.length)return;
      let lo=Infinity,hi=-Infinity;pts.forEach(p=>{lo=Math.min(lo,p[1]);hi=Math.max(hi,p[1]);});
      if(hi===lo){hi=lo+1}
      ctx.strokeStyle=t.color;ctx.lineWidth=t.key===activeTrack?2:1;ctx.beginPath();
      let started=false;
      pts.forEach(p=>{
        const vt=p[0]-project.global_offset_s-trackOffset(t.key);
        const x=vt/duration*w, yy=y+rowH-8-(p[1]-lo)/(hi-lo)*(rowH-28);
        if(x<0||x>w)return;
        if(!started){ctx.moveTo(x,yy);started=true}else ctx.lineTo(x,yy);
      });ctx.stroke();
    });
    const x=(video?.currentTime||0)/duration*w;
    ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(x-5,0);ctx.lineTo(x+5,0);ctx.lineTo(x,7);ctx.fill();
  }
  function tick() {
    if(video){
      const d=video.duration||probe?.video?.duration||0;
      root.querySelector('#st-clock').textContent=`${fmt(video.currentTime)} / ${fmt(d)}`;
      root.querySelector('#st-scrub').value=video.currentTime||0;
    }
    draw(); raf=requestAnimationFrame(tick);
  }

  async function enterOverlay() {
    readControls();
    await API.saveStudioProject(project);
    if (typeof State !== 'undefined') {
      State.set('previewSession', {
        studio: true, csv_path: '', video_paths: project.video_path ? [project.video_path] : [],
        sync_offset: project.global_offset_s || 0,
        video_w: probe?.video?.width || 0, video_h: probe?.video?.height || 0,
        duration: probe?.video?.duration || video?.duration || 0,
      });
    }
    Router.navigate('editor');
  }

  function wire() {
    video=root.querySelector('#st-video');canvas=root.querySelector('#st-timeline');ctx=canvas.getContext('2d');
    root.querySelector('#st-pick-video').onclick=()=>pick('video');
    root.querySelector('#st-pick-blf').onclick=()=>pick('blf');
    root.querySelector('#st-config-dbc').onclick=async()=>{await save();Router.navigate('dbc');};
    root.querySelector('#st-toggle-tracks').onclick=()=>{const body=root.querySelector('#st-track-manager-body');const open=body.style.display !== 'none';body.style.display=open?'none':'';root.querySelector('#st-toggle-tracks').textContent=open?'展开选择 Signal':'收起 Signal 选择';};
    root.querySelector('#st-load').onclick=load;
    root.querySelector('#st-save').onclick=save;
    root.querySelector('#st-overlay').onclick=enterOverlay;
    root.querySelector('#st-next-overlay').onclick=enterOverlay;
    root.querySelector('#st-play').onclick=()=>video.paused?video.play():video.pause();
    root.querySelector('#st-scrub').oninput=e=>video.currentTime=Number(e.target.value);
    root.querySelectorAll('[data-nudge]').forEach(b=>b.onclick=()=>{
      const i=root.querySelector('#st-global');i.value=(Number(i.value)+Number(b.dataset.nudge)).toFixed(3);
      readControls();draw();
    });
    ['#st-global','#st-steer','#st-yaw'].forEach(id=>root.querySelector(id).oninput=()=>{readControls();draw();});
    root.querySelectorAll('[data-track]').forEach(b=>b.onclick=()=>{
      activeTrack=b.dataset.track;root.querySelectorAll('[data-track]').forEach(x=>x.classList.toggle('active',x===b));draw();
    });
    root.querySelectorAll('[data-gauge]').forEach(b=>b.onclick=enterOverlay);
    canvas.onclick=e=>{if(!probe)return;const r=canvas.getBoundingClientRect();video.currentTime=(e.clientX-r.left)/r.width*probe.video.duration;};
    root.querySelector('#st-pick-output').onclick=async()=>{
      const folder=await API.openFolderDialog(project.output_path).catch(()=>null);if(!folder)return;
      project.output_path=folder.replace(/[\\/]$/,'')+'\\openlap_studio_export.mp4';
      root.querySelector('#st-output').value=project.output_path;
    };
    root.querySelector('#st-export').onclick=async()=>{
      if(exporting){await API.cancelStudioExport();return}
      readControls();
      if(!project.video_path||!project.blf_path||!project.output_path)return setStatus('请选择素材与输出文件');
      exporting=true;root.querySelector('#st-export').textContent='取消导出';setExportProgress(0,'starting','正在启动导出…');
      const r=await API.startStudioExport(project);if(!r?.ok){exporting=false;setStatus(r?.error||'启动失败')}
    };
    unlisten.push(API.on('studio-export-progress',e=>{
      setExportProgress(e.percent,e.stage,e.message||'');
    }));
    unlisten.push(API.on('studio-export-log',e=>setStatus(e.message||'')));
    unlisten.push(API.on('studio-export-done',e=>{
      exporting=false;root.querySelector('#st-export').textContent='导出视频';
      setExportProgress(e.ok?100:(Number.isFinite(Number(e.percent))?e.percent:exportProgress),e.ok?'done':(e.cancelled?'cancelled':'failed'),'');
      setExportLogs(e.last_logs ?? e.lastLogs ?? e.logs ?? e.log);
      setStatus(e.ok?'导出完成：'+e.output_path:(e.cancelled?'已取消':'导出失败：'+(e.error||'未知错误')));
    }));
    resizeObserver = new ResizeObserver(()=>{resizeCanvas();draw()});
    resizeObserver.observe(canvas);
    raf=requestAnimationFrame(tick);
  }

  async function mount(el) {
    const myGen = ++mountGen;
    root=el;
    const saved=await API.getStudioProject().catch(()=>({}));
    if (myGen !== mountGen || !root?.isConnected) return;
    project={...project,...(saved||{})};
    project.track_signals = project.track_signals || {};
    normalizeTrackConfigs();
    project.dbc_bindings = Object.fromEntries(Object.entries(project.dbc_bindings || {}).map(([ch, value]) =>
      [ch, Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : [])]
    ));
    root.innerHTML=html();wire();resizeCanvas();
    renderBindings();
    renderDbcSummary();
    renderTrackPickers();
    if (project.video_path) await showVideo(myGen);
    if (myGen !== mountGen || !root?.isConnected) return;
    if (project.video_path && project.blf_path) {
      if (!(project.channels||[]).length) scanChannels(myGen);
      if (probe && loadedMediaKey === mediaKey()) {
        root.querySelector('#st-scrub').max = probe.video.duration || 1;
        setStatus('已恢复素材与波形，不需要重新扫描 BLF');
        draw();
      } else if (Object.values(project.dbc_bindings||{}).some(v => (Array.isArray(v) ? v.length : !!v))) {
        load();
      }
    }
  }
  function unmount(){
    mountGen++;
    if(video) lastVideoTime=video.currentTime||lastVideoTime;
    if(raf)cancelAnimationFrame(raf);
    if(resizeObserver){resizeObserver.disconnect();resizeObserver=null}
    unlisten.forEach(f=>f());unlisten=[];
    root=video=canvas=ctx=null;
  }
  Router.register('studio',{mount,unmount});
})();
