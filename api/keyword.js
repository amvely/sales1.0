const crypto = require('crypto');

// ─── HMAC-SHA256 서명 (Node.js crypto) ───────────────────────────────────
function makeSignature(secretKey, timestamp, method, path) {
  const message = `${timestamp}.${method}.${path}`;
  return crypto
    .createHmac('sha256', Buffer.from(secretKey, 'utf-8'))
    .update(message)
    .digest('base64');
}

// ─── 검색광고 API 호출 ────────────────────────────────────────────────────
async function adGet(path, { customerId, accessLicense, secretKey }) {
  const timestamp = Date.now().toString();
  const pathOnly = path.split('?')[0];
  const signature = makeSignature(secretKey, timestamp, 'GET', pathOnly);

  const res = await fetch(`https://api.searchad.naver.com${path}`, {
    headers: {
      'X-Timestamp': timestamp,
      'X-API-KEY': accessLicense,
      'X-Customer': String(customerId),
      'X-Signature': signature,
    },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`검색광고 API ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ─── 데이터랩 API 호출 ────────────────────────────────────────────────────
async function fetchDatalab(keyword, { clientId, clientSecret }) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 12);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
    body: JSON.stringify({
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      timeUnit: 'month',
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`데이터랩 API ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ─── 숫자 파싱 ────────────────────────────────────────────────────────────
function parseNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/,/g, '').trim();
  if (s.startsWith('<')) return 5;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function findKw(list, keyword) {
  const norm = (s) => String(s).replace(/\s/g, '').toLowerCase();
  return list.find((k) => norm(k.relKeyword) === norm(keyword)) || list[0];
}

function extractRankCpcs(kw, count) {
  const result = [];
  for (let i = 1; i <= count; i++) {
    const val =
      kw[`monthlyAvgRank${i}Cpc`] ??
      kw[`monthlyAvgRank${i}CPC`] ??
      null;
    result.push(parseNum(val));
  }
  return result.every((v) => v === null) ? null : result;
}

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS — 크롬 익스텐션에서 호출 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { keyword, adConfig, datalabConfig } = req.body;

  if (!keyword) return res.status(400).json({ error: 'keyword 필요' });
  if (!adConfig?.customerId || !adConfig?.accessLicense || !adConfig?.secretKey)
    return res.status(400).json({ error: '검색광고 API 키 누락' });
  if (!datalabConfig?.clientId || !datalabConfig?.clientSecret)
    return res.status(400).json({ error: '데이터랩 API 키 누락' });

  const [baseR, pcR, moR, dlR] = await Promise.allSettled([
    adGet(`/keywordstool?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1`, adConfig),
    adGet(`/keywordstool?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1&device=pc`, adConfig),
    adGet(`/keywordstool?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1&device=mo`, adConfig),
    fetchDatalab(keyword, datalabConfig),
  ]);

  // 검색량
  let searchVolume = null;
  if (baseR.status === 'fulfilled') {
    const list = baseR.value?.keywordList || [];
    if (list.length > 0) {
      const kw = findKw(list, keyword);
      const pc = parseNum(kw.monthlyPcQcCnt);
      const mo = parseNum(kw.monthlyMobileQcCnt);
      searchVolume = { pc, mobile: mo, total: (pc || 0) + (mo || 0), competition: kw.compIdx ?? null };
    }
  }

  // 입찰가
  let pcBids = null;
  if (pcR.status === 'fulfilled') {
    const list = pcR.value?.keywordList || [];
    if (list.length > 0) pcBids = extractRankCpcs(findKw(list, keyword), 5);
  }

  let moBids = null;
  if (moR.status === 'fulfilled') {
    const list = moR.value?.keywordList || [];
    if (list.length > 0) moBids = extractRankCpcs(findKw(list, keyword), 3);
  }

  // 트렌드
  let trendData = null;
  if (dlR.status === 'fulfilled') {
    const results = dlR.value?.results;
    if (results?.length > 0) {
      trendData = results[0].data.map((d) => ({ period: d.period, ratio: Number(d.ratio) }));
    }
  }

  const errors = [baseR, pcR, moR, dlR]
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message);

  return res.status(200).json({
    keyword,
    searchVolume,
    pcBids,
    moBids,
    trendData,
    errors: errors.length ? errors : null,
  });
};
