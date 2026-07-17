/**
 * export_params.js — buildExportParams tests.
 *
 * This is the params object sent to API.startExport(), now built on the
 * Overlay tab (editor.js) rather than the Export page. Extracted as a pure
 * function specifically so it stays testable without mounting editor.js's
 * full video/canvas page.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadExportParams() {
  const code = readFileSync(resolve(__dirname, '../js/export_params.js'), 'utf8');
  return new Function(`${code}; return ExportParams;`)();
}

describe('buildExportParams', () => {
  const ITEMS = [{ csv_path: '/data/a.csv', lap_idx: 0, scope: 'selected_lap' }];

  test('passes items through unchanged', () => {
    const { buildExportParams } = loadExportParams();
    const params = buildExportParams({ items: ITEMS, cfg: {}, layout: {} });
    expect(params.items).toBe(ITEMS);
  });

  test('ref_mode defaults to "none" when layout has no ref_mode', () => {
    const { buildExportParams } = loadExportParams();
    const params = buildExportParams({ items: ITEMS, cfg: {}, layout: {} });
    expect(params.ref_mode).toBe('none');
  });

  test('ref_mode is forwarded from layout', () => {
    const { buildExportParams } = loadExportParams();
    const params = buildExportParams({ items: ITEMS, cfg: {}, layout: { ref_mode: 'session_best' } });
    expect(params.ref_mode).toBe('session_best');
  });

  test('speed_unit defaults to "auto" when config has no speed_unit', () => {
    const { buildExportParams } = loadExportParams();
    const params = buildExportParams({ items: ITEMS, cfg: {}, layout: {} });
    expect(params.speed_unit).toBe('auto');
  });

  test('speed_unit is forwarded from config', () => {
    const { buildExportParams } = loadExportParams();
    const params = buildExportParams({ items: ITEMS, cfg: { speed_unit: 'mph' }, layout: {} });
    expect(params.speed_unit).toBe('mph');
  });

  test('encoder/crf/workers/export_path are forwarded from config with sensible defaults', () => {
    const { buildExportParams } = loadExportParams();
    const defaults = buildExportParams({ items: ITEMS, cfg: {}, layout: {} });
    expect(defaults.encoder).toBe('libx264');
    expect(defaults.crf).toBe(18);
    expect(defaults.workers).toBe(4);
    expect(defaults.export_path).toBe('');

    const custom = buildExportParams({
      items: ITEMS,
      cfg: { encoder: 'h264_nvenc', crf: 20, workers: 8, export_path: 'C:\\out' },
      layout: {},
    });
    expect(custom.encoder).toBe('h264_nvenc');
    expect(custom.crf).toBe(20);
    expect(custom.workers).toBe(8);
    expect(custom.export_path).toBe('C:\\out');
  });

  test('is_bike/show_map/show_tel default sensibly and forward from layout', () => {
    const { buildExportParams } = loadExportParams();
    const defaults = buildExportParams({ items: ITEMS, cfg: {}, layout: {} });
    expect(defaults.is_bike).toBe(false);
    expect(defaults.show_map).toBe(true);
    expect(defaults.show_tel).toBe(true);

    const custom = buildExportParams({
      items: ITEMS, cfg: {}, layout: { is_bike: true, show_map: false, show_tel: false },
    });
    expect(custom.is_bike).toBe(true);
    expect(custom.show_map).toBe(false);
    expect(custom.show_tel).toBe(false);
  });

  test('the full layout object is passed through as params.layout', () => {
    const { buildExportParams } = loadExportParams();
    const layout = { gauges: [{ channel: 'speed' }], theme: 'Dark' };
    const params = buildExportParams({ items: ITEMS, cfg: {}, layout });
    expect(params.layout).toBe(layout);
  });

  test('handles missing cfg/layout without throwing', () => {
    const { buildExportParams } = loadExportParams();
    expect(() => buildExportParams({ items: ITEMS })).not.toThrow();
  });
});
