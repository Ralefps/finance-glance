import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

let corpCodeMapCache = null;
let lastFetchTime = 0;

// DART 고유번호 목록 가져오기 (메모리 캐싱 적용)
async function getCorpCodeMap(apiKey) {
  const NOW = Date.now();
  // 24시간 동안 캐시 유지
  if (corpCodeMapCache && (NOW - lastFetchTime < 24 * 60 * 60 * 1000)) {
    return corpCodeMapCache;
  }

  const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${apiKey}`;
  const response = await fetch(url, { timeout: 15000 }); // 15초 타임아웃
  
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

      map.set(corpName, { corpCode, stockCode });
      map.set(stockCode, { corpCode, stockCode, corpName });
    }
  });

  corpCodeMapCache = map;
  lastFetchTime = NOW;
  return corpCodeMapCache;
}

export async function getDartData(query, apiKey) {
  try {
    const corpMap = await getCorpCodeMap(apiKey);
    const cleanQuery = query.trim();

    let target = corpMap.get(cleanQuery);

    // Exact Match 실패 시 부분 일치 검색
    if (!target) {
      for (const [key, value] of corpMap.entries()) {
        if (key.includes(cleanQuery)) {
          target = value;
          break;
        }
      }
    }

    if (!target) {
      throw new Error(`'${query}'에 해당하는 한국 상장사를 DART에서 찾을 수 없습니다.`);
    }

    const { corpCode, stockCode, corpName } = target;
    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    // 사업보고서 주요계정 조회 (최신 연도)
    const fnUrl = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${apiKey}&corp_code=${corpCode}&bsns_year=${lastYear}&reprt_code=11011`;
    const fnRes = await fetch(fnUrl);
    const fnData = await fnRes.json();

    let revenue = "데이터 없음";
    let opProfit = "데이터 없음";
    let netProfit = "데이터 없음";

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
      id: `${stockCode}.KS`,
      name: corpName || cleanQuery,
      ticker: `${stockCode}.KS`,
      market: "KR",
      sector: "한국 상장기업",
      financials: {
        revenue: { v: revenue, yoy: null },
        opProfit: { v: opProfit, yoy: null },
        netProfit: { v: netProfit, yoy: null },
        opMargin: { v: "별도 계산 필요", yoy: null },
        debtRatio: { v: "데이터 없음", yoy: null },
        currentRatio: { v: "데이터 없음", yoy: null },
        roe: { v: "데이터 없음", yoy: null },
        roa: { v: "데이터 없음", yoy: null },
        per: { v: "데이터 없음", yoy: null },
        pbr: { v: "데이터 없음", yoy: null }
      },
      analyst: null,
      sectorGrowth: null,
      industry: null,
      news: [],
      segments: [],
      cashflow: null,
      earningsQuality: { flag: "caution", note: "실시간 DART 조회 데이터입니다." }
    };
  } catch (error) {
    console.error("DART Fetch Error:", error);
    throw error;
  }
}
