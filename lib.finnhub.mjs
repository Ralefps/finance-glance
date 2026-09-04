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

  const usd = (v) => (v == null ? '데이터 없음' : `$${v.toLocaleString()}M`);
  const pct = (v) => (v == null ? '데이터 없음' : `${v.toFixed(1)}%`);
  const ratio = (v) => (v == null ? '데이터 없음' : `${v.toFixed(1)}배`);

  return {
    profile: {
      name: profile.name,
      sector: profile.finnhubIndustry,
    },
    financials: {
      revenue: { v: usd(m.revenuePerShareTTM * m.sharesOutstanding), yoy: m.revenueGrowthTTMYoy ?? null },
      opProfit: { v: '별도 계산 필요', yoy: null }, // Finnhub 무료 티어는 영업이익을 별도 필드로 안 줘서 as-reported 재무제표 엔드포인트가 추가로 필요합니다.
      netProfit: { v: usd(m.netIncomeTTM), yoy: null },
      opMargin: { v: pct(m.operatingMarginTTM * 100), yoy: null },
      debtRatio: { v: pct(m['totalDebt/totalEquityAnnual'] * 100), yoy: null },
      currentRatio: { v: pct(m.currentRatioAnnual * 100), yoy: null },
      roe: { v: pct(m.roeTTM * 100), yoy: null },
      roa: { v: pct(m.roaTTM * 100), yoy: null },
      per: { v: ratio(m.peTTM), yoy: null },
      pbr: { v: ratio(m.pbAnnual), yoy: null },
    },
  };
}
