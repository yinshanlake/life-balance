// pages/meal/tablesharing/tablesharing.js
import { fetchUserInfo } from "../../../repository/userRepo";
const { formatDate } = require("../../../common/util");

Page({

  /**
   * Page initial data
   */
  data: {
    imagePath: undefined,
    userInfo: undefined,
    tableConfirmed: false,
    selecting: true,
    area: "A",
    index: "11",
    areas: ["A", "B", "C", "D", "VIP"],
    tableMap: {
      A: [11, 12, 21, 22, 23, 24, 25, 26, 31, 32, 33, 34, 35, 41, 42],
      B: [11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 31, 32, 33, 34, 35, 41, 42, 43, 44, 45],
      C: [11, 12, 13, 14, 21, 22, 23, 31, 32, 33, 41, 42, 51, 52, 53, 54],
      D: [11, 12, 13, 14, 21, 22, 23, 31, 32, 33, 41, 42, 43, 51, 52, 53, 61],
      VIP: [1, 2]
    },
    // todo replace with real data
    tableCoords: {
      A: { "11": [40, 71], "12": [87, 75] },
      B: { "11": [45, 98], "12": [45, 68] },
      C: { "11": [45, 68], "12": [75, 168] },
      D: { "11": [55, 68], "12": [45, 68] },
      VIP: { "1": [600, 350], "2": [800, 400] }
    },
    map: {
      scale: 1,
      baseWidth: 814,
      baseHeight: 457,
      scaleWidth: 814,
      scaleHeight: 457
    }
  },

  scaleChange(e) {
    console.log(e)
    this.scale(e.detail.value)
  },

  scale(newScale) {
    let map = this.data.map
    let scaleWidth = newScale * map.baseWidth
    let scaleHeight = newScale * map.baseHeight

    this.setData({
      'map.scale': newScale,
      'map.scaleWidth': scaleWidth,
      'map.scaleHeight': scaleHeight,
    })

    console.log(this.data.map)
  },

  bindShowMsg() {
    this.setData({
      selecting: !this.data.selecting,
    })

    // re-select
    if (!this.data.tableConfirmed) {
      this.setData({
        area: "",
        index: "",
      })
    }

    if (this.data.selecting) {
      this.setData({
        area: "A",
        index: "11",
        tableConfirmed: false,
      })
    }

    this.drawImage()
    this.scale(0.8)
  },

  /**
   * Lifecycle function--Called when page load
   */
  onLoad(options) {

    const { user, area, index, time } = options;

    if (user && area && index) {
      this.setData({
        fromUser: user,
        area: area,
        index: index,
        date: time,

        tableConfirmed: true,
        selecting: false
      });
    }

    fetchUserInfo().then(userInfo => {
      this.setData({
        userInfo
      })
    })

    this.drawImage()
    this.scale(0.8)
  },


  onTableConfirmed(e) {
    console.log("onTableConfirmed")
    this.setData({
      tableConfirmed: true,
      selecting: false
    })
    this.drawArrow()
    this.scale(0.8)
  },

  drawImage() {
    // 通过 SelectorQuery 获取 Canvas 节点
    const map = this.data.map
    wx.createSelectorQuery()
      .select('#myCanvas')
      .fields({
        node: true,
        size: true,
      })
      .exec((res) => {
        console.log(res)
        console.log(this.data.imagePath)

        const width = map.baseWidth
        const height = map.baseHeight
        console.log("canvas width:" + width + "height: " + height)

        const canvas = res[0].node
        const ctx = canvas.getContext('2d')

        const dpr = wx.getSystemInfoSync().pixelRatio
        console.log("dpr: " + dpr)

        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)

        const img = canvas.createImage()

        img.onload = (e) => {
          ctx.drawImage(img, 0, 0)
          console.log("drwa image")
        }

        const setImagePath = (path) => {
          this.setData({
            imagePath: path
          })

          console.log("this.data.imagePath:" + this.data.imagePath)
        }

        if (this.data.imagePath == undefined) {
          wx.getImageInfo({
            src: 'cloud://life-6go5gey72a61a773.6c69-life-6go5gey72a61a773-1259260883/app-assets/canteen-pics/Default.png',
            success: function (res) {
              img.src = res.path
              setImagePath(res.path)
            }
          })
        }
        else {
          img.src = this.data.imagePath
        }
      })
  },

  drawArrow() {
    const drawAarrowFunc = (context, fromx, fromy, tox, toy) => {
      var headlen = 10; // length of head in pixels
      var dx = tox - fromx;
      var dy = toy - fromy;
      var angle = Math.atan2(dy, dx);

      context.beginPath()
      context.moveTo(fromx, fromy);
      context.lineTo(tox, toy);
      context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
      context.moveTo(tox, toy);
      context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
      context.strokeStyle = "red"
      context.lineWidth = 4
      context.stroke()
    };

    wx.createSelectorQuery()
      .select('#myCanvas')
      .fields({
        node: true,
        size: true,
      })
      .exec((res) => {
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const obj = this.data.tableCoords[this.data.area]

        let coords = obj[this.data.index]
        if (coords == undefined) {
          coords = [100, 100]
        }
        console.log(coords)
        console.log("draw arrow")
        drawAarrowFunc(ctx, 256, 0, coords[0], coords[1])
      })
  },

  onTablePickerChange(e) {
    var val = e.detail.value;

    let { areas, tableMap } = this.data;
    var area = areas[val[0]];
    var index = tableMap[area][val[1]];
    console.log(area + index)

    this.setData({
      area,
      index,
      selecting: true,
    })
  },

  /**
   * Lifecycle function--Called when page is initially rendered
   */
  onReady() {

  },

  /**
   * Lifecycle function--Called when page show
   */
  onShow() {

  },

  /**
   * Lifecycle function--Called when page hide
   */
  onHide() {

  },

  /**
   * Lifecycle function--Called when page unload
   */
  onUnload() {

  },

  /**
   * Page event handler function--Called when user drop down
   */
  onPullDownRefresh() {

  },

  /**
   * Called when page reach bottom
   */
  onReachBottom() {

  },

  /**
   * Called when user click on the top right corner to share
   */
  onShareAppMessage(e) {
    var table = this.data.area + this.data.index;
    var now = new Date(Date.now());
    console.log("onShareAppMessage:" + table + ":" + now)
    return {
      title: 'Canteen Table:' + table,
      path: '/pages/meal/tablesharing/tablesharing?area=' + this.data.area + '&index=' + this.data.index + '&user=' + this.data.userInfo.nickName + '&gender=' + this.data.userInfo.gender + '&time=' + formatDate(now)
    }
  }
})