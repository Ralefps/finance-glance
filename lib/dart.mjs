/**
 * lib/dart.mjs
 * -------------------------------------------------------------
 * DART(전자공시) API로 한국 상장기업을 검색하고 재무제표를 가져옵니다.
 * api/search.js가 기대하는 두 함수를 내보냅니다:
 *   - findKoreanCompany(query)      -> { corpCode, stockCode, name } | null
 *   - fetchKoreanFinancials(corpCode) -> financials 객체
 *
 * DART_API_KEY 환경변수가 필요합니다 (Vercel 프로젝트 설정 > Environment
 * Variables에 등록하세요). 발급: https://opendart.fss.or.kr
 * -------------------------------------------------------------
 */

import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

const DART_API_KEY = process.env.DART_API_KEY;

let corpCodeMapCache = null;
let lastFetchTime = 0;

// DART 고유번호 목록 가져오기 (메모리 캐싱 적용, 24시간)
async function getCorpCodeMap() {
  if (!DART_API_KEY) {
    throw new Error('DART_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const NOW = Date.now();
  if (corpCodeMapCache && (NOW - lastFetchTime < 24 * 60 * 60 * 1000)) {
    return corpCodeMapCache;
  }

  const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_API_KEY}`;
  // Node 18+ 런타임은 fetch가 내장되어 있어 별도 패키지가 필요 없습니다.
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`DART CorpCode Fetch Failed: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buffer));
  const zipEntries = zip.getEntries();

  let xmlData = '';
  zipEntries.forEach((entry) => {
    if (entry.entryName === 'CORPCODE.xml') {
      xmlData = entry.getData().toString('utf8');
    }
  });

  if (!xmlData) {
    throw new Error('CORPCODE.xml not found in DART zip');
  }

  const parser = new XMLParser();
  const jsonObj = parser.parse(xmlData);
  const list = jsonObj.result?.list || [];

  const map = new Map();
  list.forEach((item) => {
    // 상장회사만 추출 (stock_code가 존재하고 공백이 아닌 경우)
    if (item.stock_code && String(item.stock_code).trim() !== '') {
      const stockCode = String(item.stock_code).trim().padStart(6, '0');
      const corpCode = String(item.corp_code).trim().padStart(8, '0');
      const corpName = String(item.corp_name).trim();

      map.set(corpName, { corpCode, stockCode, corpName });
      map.set(stockCode, { corpCode, stockCode, corpName });
    }
  });

  corpCodeMapCache = map;
  lastFetchTime = NOW;
  return corpCodeMapCache;
}

// 회사명 또는 종목코드로 검색 (정확히 일치 -> 부분 일치 순)
export async function findKoreanCompany(query) {
  const corpMap = await getCorpCodeMap();
  const cleanQuery = query.trim();

  let target = corpMap.get(cleanQuery);

  if (!target) {
    for (const [key, value] of corpMap.entries()) {
      if (key.includes(cleanQuery)) {
        target = value;
        break;
      }
    }
  }

  if (!target) {
    return null;
  }

  return {
    corpCode: target.corpCode,
    stockCode: target.stockCode,
    name: target.corpName,
  };
}

// 사업보고서 주요계정 조회 (최신 연도)
export async function fetchKoreanFinancials(corpCode) {
  if (!DART_API_KEY) {
    throw new Error('DART_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;

  const fnUrl = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${DART_API_KEY}&corp_code=${corpCode}&bsns_year=${lastYear}&reprt_code=11011`;
  const fnRes = await fetch(fnUrl);
  const fnData = await fnRes.json();

  let revenue = '데이터 없음';
  let opProfit = '데이터 없음';
  let netProfit = '데이터 없음';

  if (fnData.status === '000' && fnData.list) {
    fnData.list.forEach((item) => {
      const amount = Number(item.thstrm_amount || 0);
      const amountBillion = (amount / 100000000).toFixed(0); // 억 원 단위

      if (item.account_nm.includes('매출액') || item.account_nm.includes('수익(매출액)')) {
        revenue = `${Number(amountBillion).toLocaleString()}억 원`;
      } else if (item.account_nm.includes('영업이익')) {
        opProfit = `${Number(amountBillion).toLocaleString()}억 원`;
      } else if (item.account_nm.includes('당기순이익')) {
        netProfit = `${Number(amountBillion).toLocaleString()}억 원`;
      }
    });
  }

  return {
    revenue: { v: revenue, yoy: null },
    opProfit: { v: opProfit, yoy: null },
    netProfit: { v: netProfit, yoy: null },
    opMargin: { v: '별도 계산 필요', yoy: null },
    debtRatio: { v: '데이터 없음', yoy: null },
    currentRatio: { v: '데이터 없음', yoy: null },
    roe: { v: '데이터 없음', yoy: null },
    roa: { v: '데이터 없음', yoy: null },
    per: { v: '데이터 없음', yoy: null },
    pbr: { v: '데이터 없음', yoy: null },
  };
}
