const DAY = 86400000;
const OFFSET = 8 * 60 * 60 * 1000;

function shanghaiDate(now) {
  return new Date(now + OFFSET).toISOString().slice(0, 10);
}

function daysBefore(date, days) {
  return new Date(Date.parse(date) - days * DAY).toISOString().slice(0, 10);
}

function timeLabel(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function buildModel(history, lot, now) {
  const windows = history.windows;
  const points = history.samples.map(sample => {
    if (!Number.isInteger(sample.minute) || sample.minute < 0 || sample.minute >= 1440 ||
        !Number.isSafeInteger(sample[lot]) || sample[lot] < 0 ||
        !Number.isInteger(sample.intervalMinutes) || sample.intervalMinutes <= 0) {
      throw new Error('Invalid parking history sample');
    }
    const window = windows.find(item => sample.minute >= item.startMinute && sample.minute <= item.endMinute);
    return {
      minute: sample.minute,
      value: sample[lot],
      intervalMinutes: sample.intervalMinutes,
      window: sample.window || (window ? window.name : 'legacy'),
    };
  });
  points.forEach((point, index) => {
    const previous = points[index - 1];
    point.connectFromPrevious = Boolean(previous && previous.window === point.window &&
      point.minute - previous.minute === previous.intervalMinutes);
  });
  const byMinute = new Map(points.map(point => [point.minute, point]));
  const start = Math.min(...windows.map(window => window.startMinute), ...points.map(point => point.minute));
  const end = Math.max(...windows.map(window => window.endMinute), ...points.map(point => point.minute));
  const maximum = Math.max(1, ...points.map(point => point.value));
  const cells = [];
  const seen = new Set();
  function cell(minute) {
    const point = byMinute.get(minute);
    const item = {
      minute, index: cells.length,
      label: timeLabel(minute),
      value: point ? point.value : null,
      color: !point ? '#e5e7eb' : point.value === 0 ? '#e35b55' :
        point.value <= 20 ? '#e8a849' : '#4387bd',
    };
    cells.push(item);
    seen.add(minute);
    return item;
  }
  const heatGroups = windows.map(window => {
    const minutes = new Set();
    for (let minute = window.startMinute; minute <= window.endMinute; minute += window.intervalMinutes) {
      minutes.add(minute);
    }
    points.filter(point => point.minute >= window.startMinute && point.minute <= window.endMinute)
      .forEach(point => minutes.add(point.minute));
    return {
      name: window.name,
      label: window.name === 'morning' ? '早高峰' : '晚高峰',
      startLabel: timeLabel(window.startMinute), endLabel: timeLabel(window.endMinute),
      intervalMinutes: window.intervalMinutes,
      cells: [...minutes].sort((a, b) => a - b).map(cell),
    };
  });
  const otherPoints = points.filter(point => !seen.has(point.minute));
  if (otherPoints.length) {
    heatGroups.push({
      name: 'legacy', label: '其他历史实测时段',
      startLabel: timeLabel(otherPoints[0].minute),
      endLabel: timeLabel(otherPoints[otherPoints.length - 1].minute),
      cells: otherPoints.map(point => cell(point.minute)),
    });
  }
  const local = new Date(now + OFFSET);
  const currentMinute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const activeWindow = windows.find(window => currentMinute >= window.startMinute && currentMinute <= window.endMinute);
  const sameTime = activeWindow && points.filter(point => point.window === activeWindow.name &&
    point.minute <= currentMinute && currentMinute < point.minute + point.intervalMinutes).pop();
  return {
    points, cells, heatGroups, start, end, maximum, currentMinute,
    startLabel: timeLabel(start), endLabel: timeLabel(end),
    sameTimeText: !activeWindow ? '当前时间不在采集时段' :
      sameTime ? `${timeLabel(sameTime.minute)} 采样：${sameTime.value} 个` : '当前时段没有采样',
  };
}

module.exports = { shanghaiDate, daysBefore, timeLabel, buildModel };
