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
  const points = history.samples.map(sample => ({
    minute: sample.minute,
    value: sample[lot],
    intervalMinutes: sample.intervalMinutes || history.intervalMinutes
  }));
  const byMinute = new Map(points.map(point => [point.minute, point]));
  const start = Math.min(history.startHour * 60, ...points.map(point => point.minute));
  const end = Math.max(history.endHour * 60, ...points.map(point => point.minute + point.intervalMinutes));
  const minutes = new Set(points.map(point => point.minute));
  for (let minute = start; minute < end; minute += history.intervalMinutes) minutes.add(minute);
  const maximum = Math.max(1, ...points.map(point => point.value));
  const cells = [...minutes].sort((a, b) => a - b).map(minute => {
    const point = byMinute.get(minute);
    return {
      minute,
      label: timeLabel(minute),
      value: point ? point.value : null,
      color: !point ? '#e5e7eb' : point.value === 0 ? '#e35b55' :
        point.value <= 20 ? '#e8a849' : '#4387bd',
    };
  });
  const local = new Date(now + OFFSET);
  const currentMinute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const sameTime = points.find(point =>
    point.minute <= currentMinute && currentMinute < point.minute + point.intervalMinutes);
  return {
    points, cells, start, end, maximum, currentMinute,
    startLabel: timeLabel(start), endLabel: timeLabel(end),
    sameTimeText: sameTime ? `${timeLabel(sameTime.minute)} 采样：${sameTime.value} 个` : '当前时段没有采样',
  };
}

module.exports = { shanghaiDate, daysBefore, timeLabel, buildModel };
