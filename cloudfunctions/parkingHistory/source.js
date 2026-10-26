const http = require('http');

const ENDPOINT = 'http://ms.suzhouparking.kingfaster.com.cn/ParkingSpaceApi/GetData';

function parseSpaces(body) {
  if (!body || !Array.isArray(body.msparkingData)) {
    throw new Error('Parking source has no msparkingData array');
  }
  const result = {};
  for (const [name, code] of [['b25', 12], ['zhongmeng', 2]]) {
    const areas = body.msparkingData.filter(area => Number(area.areaCode) === code);
    if (areas.length !== 1) throw new Error(`Parking source missing or duplicate area ${code}`);
    const raw = areas[0].areaFreeSpaceNum;
    const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid parking count for ${name}`);
    }
    result[name] = value;
  }
  return result;
}

function fetchSpaces() {
  return new Promise((resolve, reject) => {
    const request = http.get(ENDPOINT, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Parking source HTTP ${response.statusCode}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 65536) request.destroy(new Error('Parking source response too large'));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          resolve(parseSpaces(JSON.parse(body)));
        } catch (error) {
          reject(error);
        }
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error('Parking source timeout')), 8000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
  });
}

module.exports = { fetchSpaces, parseSpaces };
