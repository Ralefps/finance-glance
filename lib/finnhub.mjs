/**
 * lib/finnhub.mjs
 * -------------------------------------------------------------
 * 미국 기업은 Finnhub이 이름/티커로 바로 검색이 되고, ratio(PER, ROE 등)를
 * 한 번의 호출로 모아서 주는 metric 엔드포인트가 있어서 한국보다 훨씬 간단합니다.
 * -------------------------------------------------------------
 */

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const BASE = 'https://finnhub.io/api/v1';

export async function findUsCompany(query) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`);
  const data = await res.json();
  // 미국 거래소의 보통주만 우선으로
  const best = (data.result || []).find((r) => r.type === 'Common Stock') || data.result?.[0];
  return best || null;
}

export async function fetchUsFinancials(symbol) {
  const [profileRes, metricRes] = await Promise.all([
    fetch(`${BASE}/stock/profile2?symbol=${symbol}&token=${FINNHUB_API_KEY}`),
    fetch(`${BASE}/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_API_KEY}`),
  ]);
  const profile = await profileRes.json();
  const metricData = await metricRes.json();
  const m = metricData.metric || {};

  // profile2의 shareOutstanding(단위: 백만 주)을 써야 합니다.
  // metric 객체 안에는 이 필드가 없어서, 예전 코드가 없는 값을 참조해 NaN이 났었습니다.
  const shares = profile.shareOutstanding;
  const revenueTotal = (m.revenuePerShareTTM != null && shares != null) ? m.revenuePerShareTTM * shares : null;
  const netIncomeTotal = (m.epsTTM != null && shares != null) ? m.epsTTM * shares : null;

  const usd = (v) => (v == null || isNaN(v) ? '데이터 없음' : `$${Math.round(v).toLocaleString()}M`);
  // operatingMarginTTM, roeTTM, roaTTM, netMarginTTM은 Finnhub이 이미 "%" 단위로 주는 값이라
  // 100을 다시 곱하면 안 됩니다 (예전 버그). 그대로 표시합니다.
  const pctAsIs = (v) => (v == null || isNaN(v) ? '데이터 없음' : `${v.toFixed(1)}%`);
  // 반대로 debt/equity, current ratio는 배수(예: 2.16)로 오기 때문에 100을 곱해야 %가 됩니다.
  const pctFromRatio = (v) => (v == null || isNaN(v) ? '데이터 없음' : `${(v * 100).toFixed(1)}%`);
  const ratio = (v) => (v == null || isNaN(v) ? '데이터 없음' : `${v.toFixed(1)}배`);

  return {
    profile: {
      name: profile.name,
      sector: profile.finnhubIndustry,
    },
    financials: {
      revenue: { v: usd(revenueTotal), yoy: m.revenueGrowthTTMYoy ?? null },
      opProfit: { v: '별도 계산 필요', yoy: null },
      netProfit: { v: usd(netIncomeTotal), yoy: null },
      opMargin: { v: pctAsIs(m.operatingMarginTTM), yoy: null },
      debtRatio: { v: pctFromRatio(m['totalDebt/totalEquityAnnual']), yoy: null },
      currentRatio: { v: pctFromRatio(m.currentRatioAnnual), yoy: null },
      roe: { v: pctAsIs(m.roeTTM), yoy: null },
      roa: { v: pctAsIs(m.roaTTM), yoy: null },
      per: { v: ratio(m.peTTM), yoy: null },
      pbr: { v: ratio(m.pbAnnual), yoy: null },
    },
  };
}
