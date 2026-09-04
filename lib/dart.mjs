/**
 * lib/dart.mjs
 * -------------------------------------------------------------
 * DART(전자공시) API로 한국 상장기업을 검색하고 재무제표를 가져옵니다.
 * api/search.js가 기대하는 두 함수를 내보냅니다:
 *   - findKoreanCompany(query)      -> { corpCode, stockCode, name } | null
 *   - fetchKoreanFinancials(corpCode) -> financials 객체
 *
 * 회사명 -> corpCode 매핑은 data/dart-corp-codes.json(미리 생성된 정적
 * 파일, scripts/fetch-corp-codes.mjs로 생성)을 우선적으로 사용합니다.
 * DART의 corpCode.xml은 상장사 전체 목록(10만+ 건)이라 매 요청마다
 * 실시간으로 다운로드+압축해제+파싱하면 Vercel 함수 실행 시간 제한을
 * 넘겨버립니다(504 FUNCTION_INVOCATION_TIMEOUT). 정적 파일이 없을 때만
 * 예전 방식(실시간 다운로드)으로 대체합니다.
 *
 * DART_API_KEY 환경변수가 필요합니다 (Vercel 프로젝트 설정 > Environment
 * Variables에 등록하세요). 발급: https://opendart.fss.or.kr
 * -------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_CORP_CODES_PATH = join(__dirname, '..', 'data', 'dart-corp-codes.json');

const DART_API_KEY = process.env.DART_API_KEY;

let corpCodeMapCache = null;
let lastFetchTime = 0;

// 정적 JSON(사전 생성본)이 있으면 그걸 즉시 로드합니다. (수십 ms)
function loadStaticCorpCodeMap() {
  let entries;
  try {
    const raw = readFileSync(STATIC_CORP_CODES_PATH, 'utf8');
    entries = JSON.parse(raw);
  } catch {
    return null; // 파일이 없으면 아래 live-fetch 방식으로 대체
  }

  const map = new Map();
  entries.forEach(({ corpCode, stockCode, corpName }) => {
    map.set(corpName, { corpCode, stockCode, corpName });
    map.set(stockCode, { corpCode, stockCode, corpName });
  });
  return map;
}

// (대체 경로) DART corpCode.xml을 실시간으로 받아 파싱 — 정적 파일이 없을 때만 사용.
// 상장사 전체 목록을 매번 새로 받기 때문에 느리고, 함수 실행 시간 제한에
// 걸릴 수 있습니다. scripts/fetch-corp-codes.mjs를 실행해 정적 파일을
// 만들어 두는 걸 강력히 권장합니다.
async function fetchLiveCorpCodeMap() {
  if (!DART_API_KEY) {
    throw new Error('DART_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_API_KEY}`;
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
    if (item.stock_code && String(item.stock_code).trim() !== '') {
      const stockCode = String(item.stock_code).trim().padStart(6, '0');
      const corpCode = String(item.corp_code).trim().padStart(8, '0');
      const corpName = String(item.corp_name).trim();

      map.set(corpName, { corpCode, stockCode, corpName });
      map.set(stockCode, { corpCode, stockCode, corpName });
    }
  });

  return map;
}

// DART 고유번호 목록 가져오기 (정적 파일 우선, 없으면 실시간 다운로드 + 24시간 메모리 캐싱)
async function getCorpCodeMap() {
  const staticMap = loadStaticCorpCodeMap();
  if (staticMap) {
    return staticMap;
  }

  const NOW = Date.now();
  if (corpCodeMapCache && (NOW - lastFetchTime < 24 * 60 * 60 * 1000)) {
    return corpCodeMapCache;
  }

  corpCodeMapCache = await fetchLiveCorpCodeMap();
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
