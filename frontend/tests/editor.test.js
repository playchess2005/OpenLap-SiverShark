/**
 * Overlay editor — export bar tests.
 *
 * Regression coverage for the export controls: scope/padding/overlay-only
 * and the "+ Add to Queue" / "▶ Export Now" actions are always visible on
 * the Overlay tab (not hidden behind a menu) — this is the only place those
 * settings exist now, since the Export tab itself has no configuration
 * controls of its own (see export.js).
 */
import {
  loadState, loadExportParams, loadPage, makeRouter, makeAPI,
  makeContainer, cleanupContainer, flushAsync,
} from './helpers.js';

const SESSION = {
  csv_path:    '/data/session.csv',
  video_paths: ['/video/clip.mp4'],
  sync_offset: 1.5,
  source:      'RaceBox',
  csv_start:   '2024-06-15T14:32:00Z',
};

const LAPS = [
  { lap_idx: 0, lap_num: 1, duration: 84.3, is_best: false, elapsed_start: 0, is_outlap: true },
  { lap_idx: 1, lap_num: 2, duration: 83.1, is_best: true,  elapsed_start: 84.3 },
];

describe('Overlay editor — export bar', () => {
  let router, container, page;

  beforeEach(async () => {
    loadState();

    // jsdom has no ResizeObserver / canvas 2D context — editor.js uses both
    // to size gauge previews. Stub just enough that mount() doesn't throw.
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    const fakeCtx = {
      clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, fill() {}, save() {}, restore() {}, arc() {}, closePath() {},
      measureText: () => ({ width: 10 }), roundRect() {},
    };
    HTMLCanvasElement.prototype.getContext = () => fakeCtx;

    router = makeRouter();
    globalThis.Router = router;
    globalThis.API = makeAPI({
      getVideoServerPort: vi.fn(async () => 0),
      getConfig:          vi.fn(async () => ({ overlay: { is_bike: false, theme: 'Dark', gauges: [] } })),
      getOverlay:         vi.fn(async () => ({ is_bike: false, theme: 'Dark', gauges: [] })),
      listPresets:        vi.fn(async () => ({})),
      getSessionMeta:     vi.fn(async () => ({ track: 'Spa-Francorchamps' })),
      getLaps:            vi.fn(async () => LAPS),
      loadLapHistory:     vi.fn(async () => []),
      getTrackMapGeometry: vi.fn(async () => ({ lats: [], lons: [] })),
    });

    // editor.js's export bar calls ExportParams.buildExportParams() — loaded
    // as a real (non-IIFE) global script in index.html, same as gauges/base.js.
    loadExportParams();
    loadPage('pages/editor.js');
    container = makeContainer();
    page      = router.getPage('editor');

    State.set('previewSession', { ...SESSION, lap_idx: 1 });
    await page.mount(container);
    await flushAsync();
    await flushAsync();
  });

  afterEach(() => {
    page?.unmount();
    cleanupContainer(container);
  });

  test('scope select, padding input, overlay-only checkbox, and both action buttons are visible without any extra click', () => {
    expect(container.querySelector('#exp-scope-sel')).not.toBeNull();
    expect(container.querySelector('#exp-padding-inp')).not.toBeNull();
    expect(container.querySelector('#exp-overlay-only-chk')).not.toBeNull();
    expect(container.querySelector('#exp-queue-btn')).not.toBeNull();
    expect(container.querySelector('#exp-now-btn')).not.toBeNull();
  });

  test('lap range picker is hidden unless scope is "Lap range"', () => {
    expect(container.querySelector('#exp-range-wrap').style.display).toBe('none');

    const scopeSel = container.querySelector('#exp-scope-sel');
    scopeSel.value = 'lap_range';
    scopeSel.dispatchEvent(new Event('change'));

    expect(container.querySelector('#exp-range-wrap').style.display).not.toBe('none');
  });

  test('"+ Add to Queue" adds the current lap without navigating away', () => {
    container.querySelector('#exp-queue-btn').click();

    const items = State.get('selectedItems') || [];
    expect(items).toHaveLength(1);
    expect(items[0].csv_path).toBe(SESSION.csv_path);
    expect(items[0].scope).toBe('selected_lap');
    expect(items[0].padding).toBe(5);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  test('changing padding is reflected on the queued item', () => {
    const paddingInp = container.querySelector('#exp-padding-inp');
    paddingInp.value = '8';
    paddingInp.dispatchEvent(new Event('change'));

    container.querySelector('#exp-queue-btn').click();
    expect(State.get('selectedItems')[0].padding).toBe(8);
  });

  test('changing scope to "Full session" is reflected on the queued item', () => {
    const scopeSel = container.querySelector('#exp-scope-sel');
    scopeSel.value = 'full';
    scopeSel.dispatchEvent(new Event('change'));

    container.querySelector('#exp-queue-btn').click();
    expect(State.get('selectedItems')[0].scope).toBe('full');
  });

  test('checking overlay-only is reflected on the queued item', () => {
    const chk = container.querySelector('#exp-overlay-only-chk');
    chk.checked = true;
    chk.dispatchEvent(new Event('change'));

    container.querySelector('#exp-queue-btn').click();
    expect(State.get('selectedItems')[0].overlay_only).toBe(true);
  });

  test('"▶ Export Now" queues the current lap, calls startExport, and navigates to export', async () => {
    const startExport = vi.fn(async () => null);
    globalThis.API.startExport = startExport;

    container.querySelector('#exp-now-btn').click();
    await flushAsync();

    expect(startExport).toHaveBeenCalledTimes(1);
    const params = startExport.mock.calls[0][0];
    expect(params.items).toHaveLength(1);
    expect(params.items[0].csv_path).toBe(SESSION.csv_path);
    expect(router.navigate).toHaveBeenCalledWith('export');
  });

  test('"▶ Export Now" does nothing if nothing can be queued and no session is loaded', async () => {
    // Fresh mount with no previewSession at all
    page.unmount();
    cleanupContainer(container);
    State.set('previewSession', null);
    State.set('selectedItems', []);

    const freshRouter = makeRouter();
    globalThis.Router = freshRouter;
    loadPage('pages/editor.js');
    const freshPage = freshRouter.getPage('editor');
    const freshContainer = makeContainer();
    await freshPage.mount(freshContainer);
    await flushAsync();

    const startExport = vi.fn(async () => null);
    globalThis.API.startExport = startExport;

    freshContainer.querySelector('#exp-now-btn').click();
    await flushAsync();

    expect(startExport).not.toHaveBeenCalled();
    expect(freshRouter.navigate).not.toHaveBeenCalled();

    freshPage.unmount();
    cleanupContainer(freshContainer);
  });
});
