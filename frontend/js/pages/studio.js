/**
 * Studio — video/BLF material selection and manual multi-track alignment.
 * Uses the official OpenLap WebView/Canvas stack and shares its Overlay editor.
 */
(function () {
  let root = null, video = null, canvas = null, ctx = null, probe = null;
  let raf = null, videoPort = 0, exporting = false;
  let exportProgress = 0;
  let unlisten = [], mountGen = 0, lastVideoTime = 0, loadedMediaKey = '';
  // Keep one trajectory request alive across Studio -> Overlay -> Studio.
  let probePromise = null, probePromiseKey = '';
  let resizeObserver = null;
  let activeTrack = 'steering';
  let timelineView = {start: 0, end: 1, initialized: false};
  let timelineDrag = null, timelineClickTimer = null, timelineSuppressClick = false;
  let selectedTimelineKeyframe = null;
  let project = {
    video_path: '', blf_path: '', output_path: '',
    global_offset_s: 0, steering_offset_s: 0, yaw_offset_s: 0,
    start_s: 0, end_s: 0, workers: 8,
    dbc_bindings: {}, channels: [], signals: [], track_signals: {}, track_configs: [], timeline_keyframes: [],
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
            <div class="studio-rail-note">轨迹由下方 Signal 列表自由选择</div>
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
              <div class="studio-track-manager-head"><strong>轨迹曲线</strong><span class="studio-muted">从扫描到的 BLF Signal 中选择并自定义名称</span><button class="btn btn-sm btn-accent" id="st-open-signals">选择 Signal</button></div>
              <div class="studio-track-manager-body" id="st-track-manager-body"></div>
            </div>
            <div class="studio-timeline">
              <div class="studio-timeline-toolbar"><strong>BLF 时间轴</strong><span id="st-timeline-range" class="studio-muted"></span><button class="btn btn-sm" data-timeline-zoom="out">−</button><button class="btn btn-sm" data-timeline-zoom="reset">全局</button><button class="btn btn-sm" data-timeline-zoom="in">+</button><button class="btn btn-sm btn-accent" id="st-align-keyframe" disabled>对齐关键帧</button><span class="studio-muted">单击黄点选择 · 对齐关键帧使白线重合 · 双击添加/删除 · 右键删除</span></div>
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
            <div class="studio-probe-progress" id="st-probe-progress" hidden>
              <div class="studio-probe-head"><span>BLF 轨迹读取</span><b id="st-probe-percent">0%</b></div>
              <div class="studio-probe-bar"><div id="st-probe-bar"></div></div>
              <div id="st-probe-label" class="studio-probe-label">准备读取…</div>
            </div>
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
  function fmtWait(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return Math.ceil(value) + ' 秒';
    const minutes = Math.floor(value / 60), rest = Math.ceil(value % 60);
    return minutes + ' 分 ' + rest + ' 秒';
  }
  function setProbeProgress(e = {}) {
    const wrap = root?.querySelector('#st-probe-progress'), bar = root?.querySelector('#st-probe-bar');
    const percentEl = root?.querySelector('#st-probe-percent'), label = root?.querySelector('#st-probe-label');
    if (!wrap || !bar || !percentEl || !label) return;
    const percent = Math.max(0, Math.min(100, Number(e.percent) || 0));
    wrap.hidden = false; wrap.classList.toggle('is-done', percent >= 100); wrap.classList.toggle('is-failed', !!e.failed);
    bar.style.width = percent + '%'; percentEl.textContent = percent.toFixed(percent < 10 && percent > 0 ? 1 : 0) + '%';
    const frames = Number(e.frames || 0), elapsed = Number(e.elapsed_s || 0), eta = Number(e.eta_s);
    const parts = []; if (frames) parts.push(frames.toLocaleString() + ' 帧'); if (elapsed) parts.push('已用 ' + fmtWait(elapsed));
    if (Number.isFinite(eta) && eta > 0 && percent < 100) parts.push('预计还需 ' + fmtWait(eta));
    if (e.result) parts.push(e.result); else if (percent >= 100) parts.push('轨迹已加载');
    label.textContent = parts.join(' · ') || (e.message || '准备读取…');
  }
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
    const chosen = configs.filter(t => t.signal).map(t => {
      const info = signalInfo(t.signal);
      return '<div class="studio-track-config" data-track-config="' + esc(t.key) + '"><input data-track-label-key="' + esc(t.key) + '" value="' + esc(t.label || '') + '" placeholder="轨迹名称"><span class="studio-track-signal" title="' + esc(t.signal) + '">' + esc(info?.label || t.signal) + '</span><button class="btn btn-sm" data-track-remove-key="' + esc(t.key) + '">删除</button></div>';
    }).join('');
    box.innerHTML = '<div class="studio-track-selected-title">已选择轨迹（' + configs.filter(t => t.signal).length + '）</div>' + (chosen || '<span class="studio-muted">尚未选择轨迹，请点击上方“选择 Signal”</span>');
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
    const hasBindings = Object.values(project.dbc_bindings || {}).some(v => Array.isArray(v) ? v.length : !!v);
    if (hasBindings) {
      await refreshCatalog();
    } else {
      setStatus('\u5df2\u53d1\u73b0 ' + project.channels.length + ' \u4e2a BLF \u901a\u9053/CAN ID\uff1b\u8bf7\u6dfb\u52a0 DBC \u540e\u52fe\u9009 Signal');
    }
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
      project.track_signals = {}; project.track_configs = []; probe = null; loadedMediaKey = '';
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

  function acquireProbe(key) {
    if (probe && loadedMediaKey === key) return Promise.resolve(probe);
    if (probePromise && probePromiseKey === key) return probePromise;
    const videoPath = project.video_path;
    const blfPath = project.blf_path;
    const bindings = JSON.parse(JSON.stringify(project.dbc_bindings || {}));
    const trackSignals = JSON.parse(JSON.stringify(project.track_signals || {}));
    probePromiseKey = key;
    const request = API.studioProbe(videoPath, blfPath, bindings, trackSignals)
      .then(result => {
        // Cache the result even if Studio is currently unmounted.
        if (probePromiseKey === key) {
          probe = result;
          loadedMediaKey = key;
        }
        return result;
      })
      .finally(() => {
        if (probePromise === request) {
          probePromise = null;
          probePromiseKey = '';
        }
      });
    probePromise = request;
    return request;
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
    const requestedKey = mediaKey();
    await showVideo(expectedGen);
    if (expectedGen !== mountGen || !root?.isConnected) return;
    setStatus('');
    setProbeProgress({percent:0, frames:0, elapsed_s:0, message:'准备读取…'});
    const button = root.querySelector('#st-load');
    if (button) button.disabled = true;
    try {
      const nextProbe = await acquireProbe(requestedKey);
      if (expectedGen !== mountGen || !root?.isConnected) return;
      probe = nextProbe;
      loadedMediaKey = requestedKey;
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
      if (expectedGen === mountGen) { setProbeProgress({percent:0, failed:true, message:'轨迹读取失败'}); setStatus('载入失败：' + e); }
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
  function blfDuration() {
    if (Number(probe?.blf?.duration) > 0) return Number(probe.blf.duration);
    const points = Object.values(probe?.traces || {}).flat();
    return points.reduce((max, p) => Math.max(max, Number(p?.[0]) || 0), 1) || 1;
  }
  function mappedBlfTime() {
    return (Number(video?.currentTime) || 0) + (Number(project.global_offset_s) || 0);
  }
  function ensureTimelineView() {
    const duration = blfDuration();
    if (!timelineView.initialized || timelineView.duration !== duration) {
      const videoDuration = Number(probe?.video?.duration) || 20;
      const span = Math.min(duration, Math.max(videoDuration * 4, 60));
      const center = Math.min(Math.max(mappedBlfTime(), span / 2), Math.max(span / 2, duration - span / 2));
      timelineView = {start: Math.max(0, center - span / 2), end: Math.min(duration, center + span / 2), duration, initialized: true};
    }
    const span = Math.max(.001, timelineView.end - timelineView.start);
    timelineView.start = Math.max(0, Math.min(timelineView.start, Math.max(0, duration - span)));
    timelineView.end = Math.min(duration, timelineView.start + span);
  }
  function setTimelineView(start, end) {
    const duration = blfDuration();
    const span = Math.max(.05, Math.min(duration, end - start));
    const safeStart = Math.max(0, Math.min(start, duration - span));
    timelineView = {start: safeStart, end: safeStart + span, duration, initialized: true};
    draw();
  }
  function timelineTimeAtX(x) {
    ensureTimelineView();
    const w = Math.max(1, canvas?.clientWidth || 1);
    return timelineView.start + Math.max(0, Math.min(1, x / w)) * (timelineView.end - timelineView.start);
  }
  function timelineZoom(factor, focus) {
    ensureTimelineView();
    const duration = blfDuration();
    const oldSpan = timelineView.end - timelineView.start;
    const anchor = Number.isFinite(focus) ? focus : mappedBlfTime();
    const ratio = oldSpan ? (anchor - timelineView.start) / oldSpan : .5;
    const minSpan = Math.max(.2, Math.min(duration, (Number(probe?.video?.duration) || 20) / 20));
    const span = Math.max(minSpan, Math.min(duration, oldSpan * factor));
    setTimelineView(anchor - span * ratio, anchor + span * (1 - ratio));
  }
  function niceTimeStep(span) {
    const raw = Math.max(.001, span / 6), power = Math.pow(10, Math.floor(Math.log10(raw)));
    const normalized = raw / power;
    return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
  }
  function draw() {
    if (!ctx || !canvas) return;
    ensureTimelineView();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const axisH = 22, plotH = Math.max(1, h - axisH);
    const start = timelineView.start, span = timelineView.end - timelineView.start;
    const duration = blfDuration();
    const activeTracks = (project.track_configs || []).filter(t => t.signal);
    const rowH = plotH / Math.max(1, activeTracks.length);
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0a0d15'; ctx.fillRect(0, 0, w, h);
    const xFor = t => (t - start) / span * w;
    activeTracks.forEach((t, i) => {
      const y = i * rowH;
      ctx.fillStyle = i % 2 ? '#0e121c' : '#101522'; ctx.fillRect(0, y, w, Math.max(1, rowH - 1));
      ctx.fillStyle = t.color || '#60a5fa'; ctx.font = '12px Segoe UI'; ctx.fillText(t.label || '轨迹', 10, y + 17);
      const pts = probe?.traces?.[t.key] || []; if (!pts.length) return;
      let lo = Infinity, hi = -Infinity; pts.forEach(p => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
      if (hi === lo) hi = lo + 1;
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, w, Math.max(1, rowH - 1)); ctx.clip();
      ctx.strokeStyle = t.color || '#60a5fa'; ctx.lineWidth = 1.5; ctx.beginPath();
      pts.forEach((p, index) => { const x = xFor(p[0]), yy = y + rowH - 8 - (p[1] - lo) / (hi - lo) * Math.max(10, rowH - 28); if (index === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); });
      ctx.stroke();
      (project.timeline_keyframes || []).filter(k => k.track === t.key).forEach(k => {
        const x = xFor(Number(k.blf_s)); if (x < -8 || x > w + 8) return;
        const ky = y + 12, selected = k === selectedTimelineKeyframe; ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(x, ky - (selected ? 8 : 6)); ctx.lineTo(x + (selected ? 8 : 6), ky); ctx.lineTo(x, ky + (selected ? 8 : 6)); ctx.lineTo(x - (selected ? 8 : 6), ky); ctx.closePath(); ctx.fill(); if (selected) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
      });
      ctx.restore();
    });
    const currentX = xFor(mappedBlfTime());
    if (currentX >= 0 && currentX <= w) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(currentX, 0); ctx.lineTo(currentX, plotH); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(currentX - 5, 0); ctx.lineTo(currentX + 5, 0); ctx.lineTo(currentX, 7); ctx.fill(); }
    const step = niceTimeStep(span); ctx.strokeStyle = 'rgba(150,170,200,.22)'; ctx.fillStyle = '#8fa4bf'; ctx.font = '10px Segoe UI';
    for (let tick = Math.ceil(start / step) * step; tick <= timelineView.end + step / 2; tick += step) { const x = xFor(tick); if (x < 0 || x > w) continue; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke(); ctx.fillText(fmt(tick), x + 3, h - 6); }
    const range = root?.querySelector('#st-timeline-range'); if (range) range.textContent = `${fmt(start)} – ${fmt(timelineView.end)} / ${fmt(duration)}`;
    const alignButton = root?.querySelector('#st-align-keyframe'); if (alignButton) alignButton.disabled = !selectedTimelineKeyframe;
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

  function timelineTrackAtY(y) {
    const activeTracks = (project.track_configs || []).filter(t => t.signal);
    const rowH = Math.max(1, (canvas.clientHeight - 22) / Math.max(1, activeTracks.length));
    return activeTracks[Math.max(0, Math.min(activeTracks.length - 1, Math.floor(y / rowH)))];
  }
  function timelineKeyframeAt(x, y) {
    const track = timelineTrackAtY(y); if (!track) return null;
    ensureTimelineView(); const sx = canvas.clientWidth / Math.max(.001, timelineView.end - timelineView.start);
    return (project.timeline_keyframes || []).find(k => k.track === track.key && Math.abs((Number(k.blf_s) - timelineTimeAtX(x)) * sx) <= 9) || null;
  }
  function seekTimeline(e) {
    if (!probe || !video) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const keyframe = timelineKeyframeAt(x, y);
    if (keyframe) {
      selectedTimelineKeyframe = keyframe;
      setStatus(`已选择 ${fmt(Number(keyframe.blf_s))} 的关键帧，点击“对齐关键帧”即可与当前视频位置重合`);
      draw(); return;
    }
    const blfTime = timelineTimeAtX(x), videoTime = blfTime - Number(project.global_offset_s || 0);
    video.currentTime = Math.max(0, Math.min(video.duration || probe.video.duration || 0, videoTime));
    draw();
  }
  async function addTimelineKeyframe(e) {
    if (!probe || !canvas) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const track = timelineTrackAtY(y); if (!track) return;
    const blfTime = timelineTimeAtX(x), videoTime = Math.max(0, Number(video?.currentTime) || 0);
    project.timeline_keyframes = Array.isArray(project.timeline_keyframes) ? project.timeline_keyframes : [];
    const keyframe = {id: `key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, track: track.key, label: track.label || '轨迹', blf_s: Number(blfTime.toFixed(3)), video_s: Number(videoTime.toFixed(3))};
    project.timeline_keyframes.push(keyframe); selectedTimelineKeyframe = keyframe;
    await save(); setStatus(`已在 ${fmt(blfTime)} 为“${track.label || '轨迹'}”添加关键帧`); draw();
  }
  async function removeTimelineKeyframe(e) {
    if (!canvas) return false;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const keyframe = timelineKeyframeAt(x, y);
    if (!keyframe) return false;
    project.timeline_keyframes = (project.timeline_keyframes || []).filter(k => k !== keyframe);
    if (selectedTimelineKeyframe === keyframe) selectedTimelineKeyframe = null;
    await save(); setStatus(`已删除 ${fmt(Number(keyframe.blf_s))} 的关键帧`); draw();
    return true;
  }
  async function alignSelectedTimelineKeyframe() {
    if (!selectedTimelineKeyframe || !video) return setStatus('请先单击一个黄色关键帧');
    const videoTime = Number(video.currentTime) || 0, blfTime = Number(selectedTimelineKeyframe.blf_s) || 0;
    const offset = blfTime - videoTime;
    project.global_offset_s = Number(offset.toFixed(3));
    const input = root?.querySelector('#st-global'); if (input) input.value = project.global_offset_s.toFixed(3);
    await API.saveStudioProject(project);
    setStatus(`对齐完成：视频 ${fmt(videoTime)} ↔ BLF ${fmt(blfTime)}，全局偏移 ${project.global_offset_s.toFixed(3)} 秒`);
    draw();
  }
  async function toggleTimelineKeyframe(e) {
    const removed = await removeTimelineKeyframe(e);
    if (!removed) await addTimelineKeyframe(e);
  }
  function wire() {
    video=root.querySelector('#st-video');canvas=root.querySelector('#st-timeline');ctx=canvas.getContext('2d');
    root.querySelector('#st-pick-video').onclick=()=>pick('video');
    root.querySelector('#st-pick-blf').onclick=()=>pick('blf');
    root.querySelector('#st-config-dbc').onclick=async()=>{await save();Router.navigate('dbc');};
    root.querySelector('#st-open-signals').onclick=async()=>{await save();Router.navigate('signals');};
    root.querySelector('#st-align-keyframe').onclick=alignSelectedTimelineKeyframe;

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
    root.querySelectorAll('[data-timeline-zoom]').forEach(button => button.onclick = () => {
      const mode = button.dataset.timelineZoom;
      if (mode === 'reset') { setTimelineView(0, blfDuration()); return; }
      timelineZoom(mode === 'in' ? .5 : 2);
    });
    canvas.onclick = e => { if (timelineSuppressClick) { timelineSuppressClick = false; return; } clearTimeout(timelineClickTimer); timelineClickTimer = setTimeout(() => seekTimeline(e), 180); };
    canvas.ondblclick = e => { clearTimeout(timelineClickTimer); timelineClickTimer = null; toggleTimelineKeyframe(e); };
    canvas.oncontextmenu = e => { e.preventDefault(); removeTimelineKeyframe(e); };
    canvas.onwheel = e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const focus = timelineTimeAtX(e.clientX - r.left); timelineZoom(e.deltaY < 0 ? .75 : 1.333333, focus); };
    canvas.onpointerdown = e => { if (e.button !== 0) return; timelineDrag = {x: e.clientX, start: timelineView.start, end: timelineView.end}; canvas.setPointerCapture?.(e.pointerId); };
    canvas.onpointermove = e => { if (!timelineDrag) return; const dx = e.clientX - timelineDrag.x; if (Math.abs(dx) > 3) timelineSuppressClick = true; const span = timelineDrag.end - timelineDrag.start, shift = dx / Math.max(1, canvas.clientWidth) * span; setTimelineView(timelineDrag.start - shift, timelineDrag.end - shift); };
    canvas.onpointerup = e => { timelineDrag = null; canvas.releasePointerCapture?.(e.pointerId); };
    canvas.onpointercancel = () => { timelineDrag = null; };
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
    // Frames/time/ETA live in the progress card; do not duplicate them below.
    unlisten.push(API.on('studio-probe-progress', e => setProbeProgress(e)));
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
    project.timeline_keyframes = Array.isArray(project.timeline_keyframes) ? project.timeline_keyframes : [];
    timelineView.initialized = false;
    selectedTimelineKeyframe = null;
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
