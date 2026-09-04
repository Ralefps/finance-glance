/**
 * api/gen-corp-codes.js
 * -------------------------------------------------------------
 * 임시 도구입니다. 터미널 없이, 그냥 브라우저에서 이 주소를 한 번 열면
 * DART 상장사 전체 목록을 JSON으로 만들어서 화면에 보여줍니다.
 * (Vercel 서버에 이미 등록된 DART_API_KEY 환경변수를 사용하므로,
 *  키를 다시 입력할 필요가 없습니다.)
 *
 * 사용법:
 *   1) 배포가 끝난 뒤, 브라우저에서 아래 주소로 접속:
 *      https://<내프로젝트>.vercel.app/api/gen-corp-codes
 *   2) 화면에 나온 JSON 전체를 복사(Ctrl+A, Ctrl+C)
 *   3) 저장소에 data/dart-corp-codes.json 파일을 새로 만들어 붙여넣기
 *   4) 완료되면 이 파일(api/gen-corp-codes.js)은 저장소에서 지워도 됩니다.
 *      (계속 남겨둬도 동작에는 문제없지만, 굳이 필요 없는 엔드포인트예요.)
 * -------------------------------------------------------------
 */

import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

export default async function handler(req, res) {
  const DART_API_KEY = process.env.DART_API_KEY;
  if (!DART_API_KEY) {
    return res.status(500).json({ error: 'DART_API_KEY 환경변수가 설정되지 않았습니다. Vercel 프로젝트 설정을 확인해주세요.' });
  }

  try {
    const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: `DART 서버 응답 실패: ${response.statusText}` });
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
      // 보통 키가 잘못됐을 때 이 zip 안에 에러 메시지 XML이 대신 들어있습니다.
      return res.status(400).json({ error: 'CORPCODE.xml을 찾지 못했습니다. DART_API_KEY가 올바른지 확인해주세요.' });
    }

    const parser = new XMLParser();
    const jsonObj = parser.parse(xmlData);
    const list = jsonObj.result?.list || [];

    const entries = [];
    list.forEach((item) => {
      if (item.stock_code && String(item.stock_code).trim() !== '') {
        const stockCode = String(item.stock_code).trim().padStart(6, '0');
        const corpCode = String(item.corp_code).trim().padStart(8, '0');
        const corpName = String(item.corp_name).trim();
        entries.push({ corpCode, stockCode, corpName });
      }
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(entries);
  } catch (err) {
    return res.status(500).json({ error: '생성 중 오류가 발생했습니다.', detail: err.message });
  }
}
