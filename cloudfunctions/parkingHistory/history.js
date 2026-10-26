const DAY = 86400000;
const OFFSET = 8 * 60 * 60 * 1000;
const COLLECTION = 'parking-history';
const COLLECT = 'parking-history-collect';
const CLEANUP = 'parking-history-cleanup';

function localTime(now) {
  const date = new Date(now + OFFSET);
  return {
    date: date.toISOString().slice(0, 10),
    weekday: date.getUTCDay(),
    minute: date.getUTCHours() * 60 + date.getUTCMinutes()
  };
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function validateConfig(config) {
  if (![10, 20, 30, 60].includes(config.intervalMinutes) ||
      !Number.isInteger(config.startHour) || !Number.isInteger(config.endHour) ||
      config.startHour < 0 || config.endHour > 24 || config.startHour >= config.endHour ||
      !Number.isInteger(config.retentionDays) || config.retentionDays < 8 || config.retentionDays > 31 ||
      !Array.isArray(config.skipDates) || config.skipDates.some(date => !isDate(date))) {
    throw new Error('Invalid parking history configuration');
  }
}

function createHandler({ db, config, fetchSpaces, clock = Date.now }) {
  validateConfig(config);
  const collection = () => db.collection(COLLECTION);

  async function cleanup(now) {
    const cutoff = localTime(now - (config.retentionDays - 1) * DAY).date;
    let removed = 0;
    // Bound the work; oversized backlogs drain over subsequent daily runs.
    for (let batch = 0; batch < 5; batch++) {
      const { data } = await collection().where({ date: db.command.lt(cutoff) }).limit(100).get();
      if (!data.length) return { removed, cutoff, hasMore: false };
      await Promise.all(data.map(document => collection().doc(document._id).remove()));
      removed += data.length;
      if (data.length < 100) return { removed, cutoff, hasMore: false };
    }
    console.warn('Parking history cleanup reached its 500-document limit', { cutoff, removed });
    return { removed, cutoff, hasMore: true };
  }

  return async function handle(event = {}, identity = {}) {
    const now = clock();
    const current = localTime(now);
    if (event.Type === 'Timer') {
      // SOURCE is supplied by the SDK, never taken from the caller's event.
      if (identity.OPENID || identity.APPID || identity.UNIONID ||
          (identity.SOURCE && !['scf', 'timer'].includes(identity.SOURCE))) {
        throw new Error('Parking history timers cannot be invoked by clients');
      }
      if (event.TriggerName === CLEANUP) return cleanup(now);
      if (event.TriggerName !== COLLECT) throw new Error('Unknown parking history timer');
      if (current.weekday === 0 || current.weekday === 6 ||
          config.skipDates.includes(current.date) ||
          current.minute < config.startHour * 60 || current.minute >= config.endHour * 60 ||
          current.minute % config.intervalMinutes !== 0) {
        return { skipped: true };
      }
      const spaces = await fetchSpaces();
      const minute = Math.floor(current.minute / config.intervalMinutes) * config.intervalMinutes;
      const id = `${current.date}-${minute}`;
      await collection().doc(id).set({
        data: {
          date: current.date, minute, sampledAt: clock(), intervalMinutes: config.intervalMinutes,
          b25: spaces.b25, zhongmeng: spaces.zhongmeng
        }
      });
      return { recorded: true };
    }
    if (event.action !== 'history') throw new Error('Unknown parking history action');
    const date = event.data && event.data.date;
    const earliest = localTime(now - (config.retentionDays - 1) * DAY).date;
    if (!isDate(date) || date < earliest || date > current.date) {
      throw new Error('Date is outside parking history retention');
    }
    const samples = [];
    for (let offset = 0; offset < 300; offset += 100) {
      const { data } = await collection().where({ date }).orderBy('minute', 'asc')
        .skip(offset).limit(100).get();
      samples.push(...data.map(item => ({
        minute: item.minute, sampledAt: item.sampledAt, intervalMinutes: item.intervalMinutes,
        b25: item.b25, zhongmeng: item.zhongmeng
      })));
      if (data.length < 100) break;
    }
    return {
      date, today: current.date, earliest,
      timezone: 'Asia/Shanghai',
      intervalMinutes: config.intervalMinutes,
      startHour: config.startHour,
      endHour: config.endHour,
      samples
    };
  };
}

module.exports = { createHandler, localTime, validateConfig };
