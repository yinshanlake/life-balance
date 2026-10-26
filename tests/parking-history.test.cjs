const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createHandler, localTime, validateConfig } = require('../cloudfunctions/parkingHistory/history');
const config = require('../cloudfunctions/parkingHistory/config');
const { parseSpaces } = require('../cloudfunctions/parkingHistory/source');

const COLLECT = { Type: 'Timer', TriggerName: 'parking-history-collect' };
const CLEANUP = { Type: 'Timer', TriggerName: 'parking-history-cleanup' };
const time = value => Date.parse(value + '+08:00');

function harness(options = {}) {
  let now = time(options.at || '2026-10-26T09:00:00');
  let requests = 0;
  const records = new Map();
  const removed = [];
  const reads = [];
  const db = {
    command: { lt: value => ({ lt: value }) },
    collection(name) {
      assert.equal(name, 'parking-history');
      return {
        doc(id) {
          return {
            async set({ data }) {
              if (options.writeError) throw new Error('Write failed');
              records.set(id, { ...data, _id: id });
            },
            async remove() {
              if (options.removeError) throw new Error('Remove failed');
              removed.push(id);
              records.delete(id);
            },
          };
        },
        where(query) {
          let limit = 100, skip = 0;
          const chain = {
            orderBy(field, direction) {
              assert.equal(field, 'minute'); assert.equal(direction, 'asc');
              return chain;
            },
            skip(value) { skip = value; return chain; },
            limit(value) { limit = value; return chain; },
            async get() {
              reads.push(query);
              if (options.readError) throw new Error('Read failed');
              const values = [...records.values()].filter(item =>
                typeof query.date === 'string' ? item.date === query.date : item.date < query.date.lt);
              values.sort((a, b) => a.minute - b.minute);
              return { data: values.slice(skip, skip + limit) };
            },
          };
          return chain;
        },
      };
    },
  };
  const handle = createHandler({
    db, config: { ...config, ...options.config }, clock: () => now,
    async fetchSpaces() {
      requests++;
      if (options.sourceError) throw new Error('Source failed');
      return { b25: 0, zhongmeng: 42 };
    },
  });
  return {
    handle, records, removed, reads,
    get requests() { return requests; },
    setTime(value) { now = time(value); },
    query(date) { return handle({ action: 'history', data: { date } }); },
  };
}

test('source parses both lots in one response, preserving real zero', () => {
  assert.deepEqual(parseSpaces({ msparkingData: [
    { areaCode: '12', areaFreeSpaceNum: '0' }, { areaCode: 2, areaFreeSpaceNum: 42 },
  ] }), { b25: 0, zhongmeng: 42 });
  for (const value of [null, '', -1, 1.5, false, 'unknown', Infinity]) {
    assert.throws(() => parseSpaces({ msparkingData: [
      { areaCode: 12, areaFreeSpaceNum: value }, { areaCode: 2, areaFreeSpaceNum: 42 },
    ] }));
  }
  assert.throws(() => parseSpaces({ msparkingData: [{ areaCode: 12, areaFreeSpaceNum: 3 }] }));
  assert.throws(() => parseSpaces({}));
  assert.throws(() => parseSpaces({ msparkingData: [
    { areaCode: 12, areaFreeSpaceNum: 3 }, { areaCode: 12, areaFreeSpaceNum: 4 },
    { areaCode: 2, areaFreeSpaceNum: 5 },
  ] }));
});

test('Shanghai date is independent of host timezone and crosses UTC midnight correctly', () => {
  assert.deepEqual(localTime(Date.parse('2026-10-25T16:00:00Z')), {
    date: '2026-10-26', weekday: 1, minute: 0,
  });
});

test('timer samples without any page view, merging both lots in an idempotent slot', async () => {
  const h = harness();
  await h.handle(COLLECT);
  await h.handle(COLLECT);
  assert.equal(h.requests, 2);
  assert.equal(h.records.size, 1);
  const record = h.records.get('2026-10-26-540');
  assert.equal(record.b25, 0);
  assert.equal(record.zhongmeng, 42);
  assert.equal(record.intervalMinutes, 10);
});

test('weekends, holidays, off-hours, unaligned minutes never call the source or write', async () => {
  for (const at of [
    '2026-10-24T09:00:00', '2026-10-25T09:00:00', '2026-10-26T06:50:00',
    '2026-10-26T19:00:00', '2026-10-26T09:01:00',
  ]) {
    const h = harness({ at });
    assert.deepEqual(await h.handle(COLLECT), { skipped: true });
    assert.equal(h.requests, 0);
    assert.equal(h.records.size, 0);
  }
  const h = harness({ config: { skipDates: ['2026-10-26'] } });
  await h.handle(COLLECT);
  assert.equal(h.requests, 0);
});

test('sampling window is start-inclusive and end-exclusive; longer interval is honored', async () => {
  const h = harness({ at: '2026-10-26T07:00:00', config: { intervalMinutes: 20 } });
  await h.handle(COLLECT);
  h.setTime('2026-10-26T18:40:00');
  await h.handle(COLLECT);
  h.setTime('2026-10-26T18:50:00');
  await h.handle(COLLECT);
  assert.equal(h.requests, 2);
});

test('default eight-day window stores at most 432 combined records and expires only the oldest day', async () => {
  const h = harness();
  for (const date of [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29',
    '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
  ]) {
    for (let minute = 0; minute < 1440; minute += 10) {
      h.setTime(`${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`);
      await h.handle(COLLECT);
    }
  }
  assert.equal(h.requests, 432);
  assert.equal(h.records.size, 432);
  assert.equal((await h.query('2026-10-26')).samples.length, 72);
  assert.equal((await h.handle(CLEANUP)).removed, 0);
  h.setTime('2026-11-03T00:05:00');
  assert.equal((await h.handle(CLEANUP)).removed, 72);
  assert.equal(h.records.size, 360);
  assert.equal(h.records.has('2026-10-27-420'), true);
});

test('spoofed client timers cannot write or delete, and unknown actions fail', async () => {
  for (const identity of [
    { OPENID: 'user' }, { APPID: 'app' }, { UNIONID: 'user' },
    { SOURCE: 'wx_client' }, { SOURCE: 'wx_client,scf' }, { SOURCE: 'http' },
  ]) {
    const h = harness();
    await assert.rejects(h.handle(COLLECT, identity), /cannot be invoked/);
    await assert.rejects(h.handle(CLEANUP, identity), /cannot be invoked/);
    assert.equal(h.requests, 0);
    assert.equal(h.reads.length, 0);
  }
  await assert.rejects(harness().handle({ Type: 'Timer', TriggerName: 'other' }), /Unknown/);
  await assert.rejects(harness().handle({ action: 'delete' }), /Unknown/);
});

test('errors propagate; failed sampling does not create a zero-shaped fallback', async () => {
  const h = harness({ sourceError: true });
  await assert.rejects(h.handle(COLLECT), /Source failed/);
  assert.equal(h.records.size, 0);
  await assert.rejects(harness({ writeError: true }).handle(COLLECT), /Write failed/);
  await assert.rejects(harness({ readError: true }).query('2026-10-26'), /Read failed/);
  const brokenCleanup = harness({ removeError: true });
  brokenCleanup.records.set('old', { _id: 'old', date: '2026-10-01' });
  await assert.rejects(brokenCleanup.handle(CLEANUP), /Remove failed/);
});

test('history includes D-7, rejects malformed/out-of-range dates, and is strictly read-only', async () => {
  const h = harness();
  for (const date of ['2026-10-19', '2026-10-26']) {
    const history = await h.query(date);
    assert.deepEqual(history.samples, []);
    assert.equal(history.earliest, '2026-10-19');
    assert.equal(history.timezone, 'Asia/Shanghai');
  }
  for (const date of ['2026-10-18', '2026-10-27', '2026-02-30', {}, null, '2026-1-1']) {
    await assert.rejects(h.query(date), /outside/);
  }
  assert.equal(h.requests, 0);
  assert.equal(h.records.size, 0);
  assert.equal(h.removed.length, 0);
});

test('history paginates past 100 records and excludes internal database IDs', async () => {
  const h = harness();
  for (let minute = 0; minute < 1440; minute += 10) {
    h.records.set(String(minute), { _id: String(minute), date: '2026-10-26', minute, b25: minute, zhongmeng: 0 });
  }
  const history = await h.query('2026-10-26');
  assert.equal(history.samples.length, 144);
  assert.equal(history.samples[143].minute, 1430);
  assert.equal('_id' in history.samples[0], false);
});

test('cleanup runs on weekends, preserves the exact retention boundary, and never scans other collections', async () => {
  const h = harness({ at: '2026-10-25T00:05:00' });
  for (const date of ['2026-10-17', '2026-10-18', '2026-10-25']) {
    h.records.set(date, { _id: date, date });
  }
  const result = await h.handle(CLEANUP);
  assert.equal(result.cutoff, '2026-10-18');
  assert.equal(result.removed, 1);
  assert.equal(h.records.has('2026-10-18'), true);
  assert.equal(h.requests, 0);
  assert.equal((await h.handle(CLEANUP)).removed, 0);
});

test('cleanup is bounded to 500 deletions and resumes safely', async () => {
  const h = harness();
  for (let i = 0; i < 601; i++) h.records.set(String(i), { _id: String(i), date: '2026-10-01' });
  const first = await h.handle(CLEANUP);
  assert.equal(first.removed, 500);
  assert.equal(first.hasMore, true);
  assert.equal(h.records.size, 101);
  assert.equal((await h.handle(CLEANUP)).removed, 101);
});

test('configuration bounds cost and retains at least the prior same weekday', () => {
  for (const override of [
    { intervalMinutes: 1 }, { startHour: -1 }, { endHour: 25 }, { startHour: 19 },
    { retentionDays: 7 }, { retentionDays: 32 }, { skipDates: ['2026-02-30'] },
  ]) assert.throws(() => validateConfig({ ...config, ...override }));
});

test('HTTP adapter uses one bounded request and rejects timeout, bad status and malformed JSON', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/parkingHistory/source.js'), 'utf8');
  async function run(mode) {
    let requests = 0, deadline, cleared = false;
    const request = new EventEmitter();
    request.destroy = error => { request.emit('error', error); request.emit('close'); };
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module, exports: module.exports,
      setTimeout(fn, ms) { assert.equal(ms, 8000); deadline = fn; return 1; },
      clearTimeout() { cleared = true; },
      require(name) {
        assert.equal(name, 'http');
        return { get(url, callback) {
          requests++;
          process.nextTick(() => {
            if (mode === 'timeout') { deadline(); return; }
            const response = new EventEmitter();
            response.statusCode = mode === 'status' ? 500 : 200;
            response.setEncoding = () => {};
            response.resume = () => {};
            callback(response);
            if (mode !== 'status') {
              response.emit('data', mode === 'json' ? '{invalid' : mode === 'large' ? 'x'.repeat(65537) :
                JSON.stringify({ msparkingData: [
                  { areaCode: 12, areaFreeSpaceNum: 0 }, { areaCode: 2, areaFreeSpaceNum: 20 },
                ] }));
              response.emit('end');
            }
            request.emit('close');
          });
          return request;
        } };
      },
    });
    if (mode === 'ok') assert.equal((await module.exports.fetchSpaces()).b25, 0);
    else await assert.rejects(module.exports.fetchSpaces());
    assert.equal(requests, 1);
    assert.equal(cleared, true);
  }
  for (const mode of ['ok', 'timeout', 'status', 'json', 'large']) await run(mode);
});
