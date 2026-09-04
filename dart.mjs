/**
 * lib/dart.mjs
 * -------------------------------------------------------------
 * 한국 기업을 이름으로 찾아서 DART에서 최신 재무제표를 실시간으로
 * 가져와 화면에서 쓰는 형태로 가공합니다.
 *
 * 회사명 -> 고유번호(corp_code) 목록은 이 파일이 처음 호출될 때
 * DART에서 직접 내려받아 메모리에 캐싱합니다. 그래서 "미리 파일을
 * 만들어서 올려두는" 준비 작업이 필요 없습니다 (완전 자동).
 * -------------------------------------------------------------
 */

import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

const DART_API_KEY = process.env.DART_API_KEY;

// 서버리스 함수가 "따뜻한 상태"로 재사용되는 동안은 이 캐시가 유지돼서
// 매 요청마다 다시 내려받지 않습니다. 완전히 새로 시작될 때(콜드 스타트)만
// 다시 받아옵니다 — 회사 목록은 자주 바뀌지 않으니 문제 없습니다.
let corpCodeCache = null;

async function loadCorpCodes() {
  if (corpCodeCache) return corpCodeCache;

  const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DART corpCode 요청 실패: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buffer);
  const xmlEntry = zip.getEntries().find((e) => e.entryName.endsWith('.xml'));
  if (!xmlEntry) throw new Error('zip 안에서 CORPCODE.xml을 찾지 못했습니다.');
  const xml = xmlEntry.getData().toString('utf-8');

  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const list = parsed.result.list;

  corpCodeCache = list
    .filter((c) => c.stock_code && String(c.stock_code).trim() !== '')
    .map((c) => ({
      name: c.corp_name,
      corpCode: String(c.corp_code).padStart(8, '0'),
      stockCode: String(c.stock_code).trim(),
    }));

  return corpCodeCache;
}

// 회사명으로 후보를 찾습니다. 정확히 일치하는 이름을 최우선으로 둡니다.
export async function findKoreanCompany(query) {
  const companies = await loadCorpCodes();
  const exact = companies.find((c) => c.name === query);
  if (exact) return exact;
  const partial = companies.filter((c) => c.name.includes(query));
  partial.sort((a, b) => a.name.length - b.name.length);
  return partial[0] || null;
}

// 최근 사업연도의 연결/별도 재무제표에서 필요한 계정을 뽑아옵니다.
export async function fetchKoreanFinancials(corpCode) {
  const year = new Date().getFullYear() - 1; // 사업보고서는 보통 전년도 기준으로 조회
  const url =
    `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json` +
    `?crtfc_key=${DART_API_KEY}&corp_code=${corpCode}&bsns_year=${year}` +
    `&reprt_code=11011&fs_div=CFS`; // 11011=사업보고서, CFS=연결재무제표

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== '000') {
    // CFS(연결)가 없는 회사는 OFS(별도)로 재시도
    const retryUrl = url.replace('fs_div=CFS', 'fs_div=OFS');
    const retryRes = await fetch(retryUrl);
    const retryData = await retryRes.json();
    if (retryData.status !== '000') {
      throw new Error(`DART 응답 오류: ${data.message || retryData.message}`);
    }
    return parseDartRows(retryData.list);
  }

  return parseDartRows(data.list);
}

// DART는 계정과목을 코드가 아니라 "한글 이름(account_nm)"으로 주기 때문에
// 이름이 일치하는 행을 찾아서 값을 뽑는 방식으로 처리합니다.
// 회사마다 표현이 살짝씩 달라 완벽하지 않을 수 있습니다 — 필요하면 목록을 더 추가하세요.
function findAccount(rows, names) {
  const row = rows.find((r) => names.includes((r.account_nm || '').replace(/\s/g, '')));
  if (!row) return null;
  const raw = (row.thstrm_amount || '0').replace(/,/g, '');
  return Number(raw) || 0;
}

function parseDartRows(rows) {
  const revenue = findAccount(rows, ['매출액', '수익(매출액)']);
  const operatingProfit = findAccount(rows, ['영업이익', '영업이익(손실)']);
  const netProfit = findAccount(rows, ['당기순이익', '당기순이익(손실)']);
  const totalAssets = findAccount(rows, ['자산총계']);
  const totalLiabilities = findAccount(rows, ['부채총계']);
  const totalEquity = findAccount(rows, ['자본총계']);
  const currentAssets = findAccount(rows, ['유동자산']);
  const currentLiabilities = findAccount(rows, ['유동부채']);

  const won = (v) => `${(v / 1_000_000_000_000).toFixed(1)}조원`; // 원 단위 -> 조원 단위 표기
  const pct = (v) => `${v.toFixed(1)}%`;

  return {
    revenue: { v: won(revenue), yoy: null }, // YoY는 전년도 데이터까지 같이 조회해야 계산 가능 (다음 단계 과제)
    opProfit: { v: won(operatingProfit), yoy: null },
    netProfit: { v: won(netProfit), yoy: null },
    opMargin: { v: pct((operatingProfit / revenue) * 100), yoy: null },
    debtRatio: { v: pct((totalLiabilities / totalEquity) * 100), yoy: null },
    currentRatio: { v: pct((currentAssets / currentLiabilities) * 100), yoy: null },
    roe: { v: pct((netProfit / totalEquity) * 100), yoy: null },
    roa: { v: pct((netProfit / totalAssets) * 100), yoy: null },
    // PER/PBR은 DART(재무제표)가 아니라 "현재 주가"가 있어야 계산되므로
    // 한국투자증권 오픈API 같은 시세 API를 추가로 붙여야 채울 수 있습니다.
    per: { v: '시세 연동 필요', yoy: null },
    pbr: { v: '시세 연동 필요', yoy: null },
  };
}
