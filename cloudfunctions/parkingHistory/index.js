const cloud = require('wx-server-sdk');
const config = require('./config');
const { fetchSpaces } = require('./source');
const { createHandler } = require('./history');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const handle = createHandler({ db: cloud.database(), config, fetchSpaces });

exports.main = async event => {
  try {
    return await handle(event, cloud.getWXContext());
  } catch (error) {
    console.error('parkingHistory failed', error);
    throw error;
  }
};
