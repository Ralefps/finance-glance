/**
 * api/search.js
 * -------------------------------------------------------------
 * 프론트엔드 검색창에서 이 주소로 요청을 보내면 됩니다:
 *   /api/search?q=삼성전자
 *   /api/search?q=Tesla
 *
 * 이 파일을 저장소의 /api 폴더에 넣고 Vercel에 배포하면,
 * Vercel이 자동으로 "https://내프로젝트.vercel.app/api/search" 라는
 * 실시간 API로 만들어줍니다. (별도 서버 설정 필요 없음)
 * -------------------------------------------------------------
 */

import { findKoreanCompany, fetchKoreanFinancials } from '../lib/dart.mjs';
import { findUsCompany, fetchUsFinancials } from '../lib/finnhub.mjs';

// 검색어에 한글이 포함되어 있으면 한국 기업으로 판단합니다.
function isKorean(text) {
  return /[가-힣]/.test(text);
}

export default async function handler(req, res) {
  const query = (req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: '검색어(q)가 필요합니다.' });
  }

  try {
    if (isKorean(query)) {
      const company = await findKoreanCompany(query);
      if (!company) {
        return res.status(404).json({ error: `'${query}'에 해당하는 국내 상장사를 찾지 못했습니다.` });
      }
      const financials = await fetchKoreanFinancials(company.corpCode);
      return res.status(200).json({
        id: company.stockCode,
        name: company.name,
        ticker: `${company.stockCode}.KS`,
        market: 'KR',
        sector: '자동 조회 (분류 정보 없음)',
        financials,
        // 아래 항목들은 raw 재무제표만으로는 만들 수 없어 일단 비워둡니다.
        // -> 다음 단계에서 Claude API로 자동 생성하거나, 사람이 직접 채울 수 있습니다.
        segments: [],
        cashflow: null,
        earningsQuality: { flag: 'caution', note: '자동 조회된 데이터라 이익의 질 분석은 아직 제공되지 않습니다.' },
        analyst: null,
        sectorGrowth: null,
        industry: null,
        news: [],
      });
    } else {
      const match = await findUsCompany(query);
      if (!match) {
        return res.status(404).json({ error: `'${query}'에 해당하는 미국 상장사를 찾지 못했습니다.` });
      }
      const { profile, financials } = await fetchUsFinancials(match.symbol);
      return res.status(200).json({
        id: match.symbol,
        name: profile.name || match.description,
        ticker: match.symbol,
        market: 'US',
        sector: profile.sector || '자동 조회',
        financials,
        segments: [],
        cashflow: null,
        earningsQuality: { flag: 'caution', note: '자동 조회된 데이터라 이익의 질 분석은 아직 제공되지 않습니다.' },
        analyst: null,
        sectorGrowth: null,
        industry: null,
        news: [],
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '데이터를 가져오는 중 오류가 발생했습니다.', detail: err.message });
  }
}
