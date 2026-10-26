const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../miniprogram/pages/home/parkinghistory/model');
const root = path.resolve(__dirname, '..');
const now = Date.parse('2026-10-26T09:25:00+08:00');
const history = {
  date: '2026-10-19', today: '2026-10-26', earliest: '2026-10-19',
  intervalMinutes: 10, startHour: 7, endHour: 19,
  samples: [
    { minute: 540, b25: 20, zhongmeng: 50, intervalMinutes: 10 },
    { minute: 550, b25: 10, zhongmeng: 40, intervalMinutes: 10 },
    { minute: 570, b25: 0, zhongmeng: 30, intervalMinutes: 10 },
  ],
};
const flush = () => new Promise(setImmediate);

function harness() {
  let definition, strokes = 0, requests = [];
  const source = fs.readFileSync(path.join(root,
    'miniprogram/pages/home/parkinghistory/parkinghistory.js'), 'utf8').replace(/^import .*;\r?\n/, '');
  const ctx = new Proxy({}, { get(target, key) {
    return () => { if (key === 'stroke') strokes++; };
  } });
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(source, {
    require() { return model; }, Date: Clock, console: { error() {} },
    fetchParkingHistory(date) {
      return new Promise((resolve, reject) => requests.push({ date, resolve, reject }));
    },
    Page(value) { definition = value; },
    wx: { createCanvasContext() { return ctx; } },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(data, callback) { Object.assign(this.data, data); if (callback) callback(); },
    createSelectorQuery() {
      const query = {
        select() { return query; },
        boundingClientRect(fn) { fn({ width: 340, height: 230 }); return query; },
        exec() {},
      };
      return query;
    },
  };
  page.onLoad();
  page.onReady();
  return { page, requests, get strokes() { return strokes; } };
}

test('model preserves gaps and zero, and uses Shanghai date rather than host local time', () => {
  const result = model.buildModel(history, 'b25', now);
  assert.equal(model.shanghaiDate(Date.parse('2026-10-25T17:00:00Z')), '2026-10-26');
  assert.equal(model.daysBefore('2026-10-26', 7), '2026-10-19');
  assert.equal(result.cells.find(cell => cell.minute === 560).value, null);
  assert.equal(result.cells.find(cell => cell.minute === 570).value, 0);
  assert.equal(result.cells.find(cell => cell.minute === 570).color, '#e35b55');
  assert.equal(result.sameTimeText, '当前时段没有采样');
  assert.equal(model.buildModel(history, 'zhongmeng', now).points[0].value, 50);
});

test('model preserves samples from earlier window/interval configurations', () => {
  const result = model.buildModel({
    ...history, startHour: 10, intervalMinutes: 20,
    samples: [{ minute: 540, b25: 0, zhongmeng: 1, intervalMinutes: 10 }],
  }, 'b25', now);
  assert.equal(result.start, 540);
  assert.equal(result.points[0].intervalMinutes, 10);
});

test('same-time comparison shows the actual observation only within its sample slot', () => {
  const result = model.buildModel(history, 'b25', Date.parse('2026-10-26T09:15:00+08:00'));
  assert.equal(result.sameTimeText, '09:10 采样：10 个');
  const empty = model.buildModel({ ...history, samples: [] }, 'b25', now);
  assert.equal(empty.points.length, 0);
  assert.equal(empty.sameTimeText, '当前时段没有采样');
});

test('date and lot switches render real data, and charts never connect across a missing slot', async () => {
  const h = harness();
  assert.equal(h.requests[0].date, '2026-10-26');
  h.requests[0].resolve(history);
  await flush();
  assert.equal(h.page.data.hasPoints, true);
  // One axis path and one adjacent pair; the 20-minute gap is not connected.
  assert.equal(h.strokes, 3); // axes, one segment, and current-time marker
  h.page.onLotChange({ currentTarget: { dataset: { lot: 'zhongmeng' } } });
  assert.equal(h.page._model.points[0].value, 50);
  assert.equal(h.requests.length, 1);
  h.page.onCellTap({ currentTarget: { dataset: { index: 15 } } });
  assert.match(h.page.data.selectedCell, /剩余车位/);
  h.page.onLastWeek();
  assert.equal(h.requests[1].date, '2026-10-19');
});

test('out-of-order responses and unloaded pages cannot overwrite the selected date', async () => {
  const h = harness();
  h.page.onDateChange({ detail: { value: '2026-10-20' } });
  h.requests[1].resolve({ ...history, date: '2026-10-20', samples: [] });
  await flush();
  h.requests[0].resolve(history);
  await flush();
  assert.equal(h.page.data.date, '2026-10-20');
  assert.equal(h.page.data.hasPoints, false);
  h.page.loadHistory();
  h.page.onUnload();
  h.requests[2].resolve(history);
  await flush();
  assert.equal(h.page.data.hasPoints, false);
});

test('no history and failed history are separate states with a working retry', async () => {
  const h = harness();
  h.requests[0].reject(new Error('Function not deployed'));
  await flush();
  assert.match(h.page.data.error, /加载失败/);
  assert.equal(h.page.data.hasPoints, false);
  h.page.loadHistory();
  h.requests[1].resolve({ ...history, samples: [] });
  await flush();
  assert.equal(h.page.data.error, '');
  assert.equal(h.page.data.hasPoints, false);
  assert.equal(h.page.data.loading, false);
});

test('both parking widgets expose a non-bubbling history entry and route is registered', () => {
  for (const widget of ['commute', 'commuteV2']) {
    const wxml = fs.readFileSync(path.join(root, `miniprogram/components/${widget}/${widget}.wxml`), 'utf8');
    assert.match(wxml, /catchtap="toParkingHistory"/);
    const source = fs.readFileSync(path.join(root, `miniprogram/components/${widget}/${widget}.js`), 'utf8');
    assert.match(source, /toParkingHistory\(\)\s*{\s*navigateToParkingHistory\(\)/);
    assert.match(source, /recordParkingFull/);
    assert.match(source, /fetchLastWeekParkingFullTime/);
  }
  const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  assert.ok(app.pages.includes('pages/home/parkinghistory/parkinghistory'));
});
