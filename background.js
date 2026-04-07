// ─── Vercel 프록시 URL ────────────────────────────────────────────────────
// 배포 후 실제 URL로 교체하세요
// 예: https://naver-keyword-proxy.vercel.app/api/keyword
const PROXY_URL = 'https://YOUR_PROJECT.vercel.app/api/keyword';

// ─── 메시지 리스너 ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'FETCH_KEYWORD_DATA') return;

  const keyword = msg.keyword;

  chrome.storage.local.get(['adConfig', 'datalabConfig'], async (data) => {
    const adConfig = data.adConfig || {};
    const datalabConfig = data.datalabConfig || {};

    if (!adConfig.customerId || !adConfig.accessLicense || !adConfig.secretKey) {
      sendResponse({ error: 'API 키 미설정 — 익스텐션 아이콘 클릭 후 설정해주세요.' });
      return;
    }
    if (!datalabConfig.clientId || !datalabConfig.clientSecret) {
      sendResponse({ error: '데이터랩 Client ID/Secret 미설정' });
      return;
    }

    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, adConfig, datalabConfig }),
      });

      const result = await res.json();
      sendResponse(result);
    } catch (err) {
      sendResponse({ error: `프록시 호출 실패: ${err.message}` });
    }
  });

  return true;
});
