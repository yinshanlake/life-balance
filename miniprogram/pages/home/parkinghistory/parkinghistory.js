import { fetchParkingHistory } from '../../../repository/dashboardRepo';
const { shanghaiDate, daysBefore, buildModel } = require('./model');

Page({
  data: {
    lot: 'b25',
    date: '',
    today: '',
    earliest: '',
    loading: true,
    error: '',
    hasPoints: false,
    cells: [],
    selectedCell: '',
  },

  onLoad() {
    this._requestId = 0;
    this._unloaded = false;
    const today = shanghaiDate(Date.now());
    this.setData({ today, earliest: daysBefore(today, 7), date: today });
    this.loadHistory();
  },

  onReady() {
    this._ready = true;
    this.drawChart();
  },

  onUnload() {
    this._unloaded = true;
    this._requestId++;
  },

  onDateChange(event) {
    this.setData({ date: event.detail.value });
    this.loadHistory();
  },

  onLastWeek() {
    this.setData({ date: daysBefore(shanghaiDate(Date.now()), 7) });
    this.loadHistory();
  },

  onLotChange(event) {
    const lot = event.currentTarget.dataset.lot;
    if (!['b25', 'zhongmeng'].includes(lot)) return;
    this.setData({ lot, selectedCell: '' });
    if (this._history) this.renderHistory();
  },

  onCellTap(event) {
    const cell = this.data.cells[event.currentTarget.dataset.index];
    this.setData({
      selectedCell: `${cell.label}：${cell.value === null ? '没有采样' : cell.value + ' 个剩余车位'}`,
    });
  },

  loadHistory() {
    const requestId = ++this._requestId;
    this._history = null;
    this.setData({ loading: true, error: '', hasPoints: false, cells: [], selectedCell: '' });
    return fetchParkingHistory(this.data.date).then(history => {
      if (this._unloaded || requestId !== this._requestId) return;
      this._history = history;
      this.setData({ today: history.today, earliest: history.earliest, loading: false });
      this.renderHistory();
    }).catch(error => {
      if (this._unloaded || requestId !== this._requestId) return;
      console.error('Failed to fetch parking history', error);
      this.setData({ loading: false, error: '历史数据加载失败，请重试。若首次部署，请确认历史云函数已部署。' });
    });
  },

  renderHistory() {
    this._model = buildModel(this._history, this.data.lot, Date.now());
    const model = this._model;
    this.setData({
      hasPoints: model.points.length > 0,
      cells: model.cells,
      startLabel: model.startLabel,
      endLabel: model.endLabel,
      sameTimeText: model.sameTimeText,
      intervalMinutes: this._history.intervalMinutes,
      sampleCount: model.points.length,
    }, () => this.drawChart());
  },

  drawChart() {
    if (!this._ready || this._unloaded || !this.data.hasPoints) return;
    const model = this._model;
    this.createSelectorQuery().select('#history-chart').boundingClientRect(rect => {
      if (!rect || this._unloaded || model !== this._model || !this.data.hasPoints) return;
      const ctx = wx.createCanvasContext('history-chart', this);
      const left = 36, top = 16, right = rect.width - 12, bottom = rect.height - 28;
      const x = minute => left + (minute - model.start) / (model.end - model.start) * (right - left);
      const y = value => bottom - value / model.maximum * (bottom - top);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.setStrokeStyle('#d1d5db');
      ctx.setLineWidth(1);
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();
      ctx.setFillStyle('#6b7280');
      ctx.setFontSize(10);
      ctx.fillText(String(model.maximum), 0, top + 4);
      ctx.fillText('0', 20, bottom + 3);
      ctx.fillText(model.startLabel, left, bottom + 20);
      ctx.fillText(model.endLabel, right - 30, bottom + 20);
      ctx.setStrokeStyle('#4387bd');
      ctx.setLineWidth(2);
      model.points.forEach((point, index) => {
        const previous = model.points[index - 1];
        if (previous && point.minute - previous.minute === previous.intervalMinutes) {
          ctx.beginPath();
          ctx.moveTo(x(previous.minute), y(previous.value));
          ctx.lineTo(x(point.minute), y(point.value));
          ctx.stroke();
        }
        ctx.setFillStyle(point.value === 0 ? '#e35b55' : '#4387bd');
        ctx.beginPath();
        ctx.arc(x(point.minute), y(point.value), 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
      if (model.currentMinute >= model.start && model.currentMinute <= model.end) {
        ctx.setStrokeStyle('#9ca3af');
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x(model.currentMinute), top);
        ctx.lineTo(x(model.currentMinute), bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.draw();
    }).exec();
  },
});
