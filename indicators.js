// 지표 정의와 팀 시범 채점. index.html(화면)과 api/rate.js(AI 프롬프트)가 같이 쓴다.
// 출처: 조별논의 회의록(2026-11-04), 분배(신현수)·절차(전세진)·인정(박병현) 지표 연구.

export const LEVELS = {
  0: "관련 제도·계획·실적이 없다는 점이 자료로 확인된다.",
  1: "목표·선언·협약·계획만 확인된다.",
  2: "법령·예산·운영기구·지원 기준 등 실행 체계가 마련되어 있다.",
  3: "실제 지급·참여·재취업·부담 완화 등 집행 실적과 결과가 확인된다.",
};

export const AXES = [
  {
    id: "d", name: "분배적 정의", en: "Distributive",
    indicators: [
      { id: "d1", name: "전환재원 중 보조금 비중",
        rule: "(상환 의무가 없는 보조금 / 전체 전환재원) × 100. 약정·배정·집행 중 같은 기준을 쓴다. 0 보조금 제도·배정 계획 없음 확인 / 1 원칙·계획만 있거나 비중이 극히 미미 / 2 전용 예산·법적 지원 기준·배정 체계 확정 / 3 실제 보조금 집행 금액과 비율이 공식 통계로 검증됨." },
      { id: "d2", name: "취약 노동자 지원 도달률",
        rule: "(실제 지원을 받은 하청·간접고용 노동자 / 지원 대상 하청·간접고용 노동자 전체) × 100. 분모와 대상 범위를 명시한다. 0 하청·간접고용을 포괄하는 제도·실적 없음 / 1 선언적 합의만, 대상 범위·집행 기준 모호 / 2 대상 범위 명시 + 이직수당·직업훈련 등 프로그램 마련 / 3 실제 참여·지급·재배치 실적이 통계로 확인됨." },
      { id: "d3", name: "소득계층별 에너지 부담 격차",
        rule: "소득분위별 (에너지·교통비 순지출 / 가처분소득)의 정책 전후 변화. 0 실태 조사·취약가구 지원 제도 없음 / 1 일반적 부담 완화 방향만 / 2 소득분위별 차등 지원 기준·바우처·기금 등 예산 체계 완비 / 3 하위 분위의 순부담 완화 실적이 통계로 입증됨." },
    ],
  },
  {
    id: "p", name: "절차적 정의", en: "Procedural",
    indicators: [
      { id: "p1", name: "이해관계자 참여",
        rule: "노동자·하청·주민·시민단체·지자체 각 집단에 대해 범위(공식 기구 참여)·시기와 접근(결정 전 참여, 접근 장벽 고려)·응답성(의견 처리 결과 회신)을 본다. 단순 참석과 발언권·의결권을 구분한다. 0 참여 제도·실적 없음 확인 / 1 참여 원칙·계획만 / 2 법령·운영기구 등 공식 기반과 참여 대상·발언 절차 마련 / 3 주요 집단의 실제 참여가 회의자료로 확인되고 발언·의결권 또는 의견 처리 결과까지 확인됨." },
      { id: "p2", name: "정보 공개",
        rule: "다섯 항목(목표·일정·담당기관 / 재원·예산·조달 조건 / 지원 대상·선정 기준·이의절차 / 집행 실적 / 성과·영향·후속조치)을 완전성·접근성·최신성으로 본다. 0 공개 제도·실적 없음 확인 / 1 공개 목표·계획만 / 2 공개 관련 법령·담당기구 등 실행 기반, 집행·성과 공개는 제한적 / 3 계획·예산·수혜 기준·집행·성과 자료가 실제 공개되고 갱신됨." },
      { id: "p3", name: "독립적 이행 점검",
        rule: "독립성(집행 주체와 분리, 이해충돌 공개)·실행·결과 공개·권고 후속조치를 본다. 독립성이 확인되지 않으면 최대 1점(상한 규칙). 0 독립 점검 제도·실적 없음 확인 / 1 점검 계획·선언만, 또는 독립성 미확인 / 2 법령·예산·기구 등 독립 점검 실행 기반 / 3 독립 기관의 실제 평가, 결과·권고 공개, 권고별 후속조치 확인." },
    ],
  },
  {
    id: "r", name: "인정의 정의", en: "Recognition",
    indicators: [
      { id: "r1", name: "취약집단의 명시적 포함",
        rule: "핵심 취약집단 2개를 먼저 지정하고 집단별로 채점해 낮은 쪽을 쓴다. 체크: ①집단을 이름으로 명시('취약계층'만은 불인정) ②자격·선정 기준 ③별도 예산 ④실제 도달 실적. 0 지원 규정 없음 확인 / 1 일반 선언 또는 ①만 / 2 ① + (② 또는 ③) / 3 2점 조건 + ④." },
      { id: "r2", name: "지역 의존도 반영",
        rule: "고용 비중·세수 비중·공급망 의존도 중 1개 이상. 체크: ①의존도를 숫자로 진단 ②진단이 대체산업·사업·예산으로 연결 ③지역 단위 집행·성과 확인. 0 지역 단위 전환 계획 없음 확인 / 1 '지역 여건 고려' 선언 또는 ①·② 중 하나만 / 2 ①+② / 3 ①+②+③." },
      { id: "r3", name: "전환 이후 추적",
        rule: "전환 대상 노동자 전체(하청·간접고용 포함 여부 따로 기록). 체크: ①추적 의무·계획 ②재취업 외 항목(임금·고용형태·근속·생활여건) ③기간·주기 명시 ④결과 공개. 0 추적 규정 없음 확인 / 1 '사후 관리' 선언 또는 일부만 / 2 ①+②+③ / 3 2점 조건 + ④." },
    ],
  },
];

export const ALL = AXES.flatMap(a => a.indicators);

// 점수: 0~3, "N" = 자료 부족(평가 유보), "X" = 해당 없음. 둘 다 지수 계산에서 빠진다.
// 팀 시범 채점(2026년 11월, 공개자료 기준 잠정값).
// refs: 팀 보고서(사례 및 확정지표 보고서, 절차적 정의 지표 연구)가 인용한 사례별 문서.
const IEA_WEI = { title: "IEA, World Energy Investment 2025 (JETP 재원 구성, p.132)", url: "https://iea.blob.core.windows.net/assets/1b241aed-501c-4612-947e-8b4ad0d234a0/WorldEnergyInvestment2025.pdf" };
export const CASES = [
  { name: "폴란드 실레지아 (TJTP)", region: "폴란드", source: "team",
    s: { d1: 2, d2: 1, d3: "N", p1: 2, p2: 2, p3: 1, r1: 1, r2: 2, r3: 1 },
    refs: [
      { title: "Silesian Voivodeship, Territorial Just Transition Plan 2021 (영문본)", url: "https://transformacja.slaskie.pl/images/Dokumenty/1683275795_sfc_tjtp_eng.pdf" },
      { title: "European Commission, Case Study: Regional Observatory of the Transition Process in Silesia (ROPT)", url: "https://ec.europa.eu/regional_policy/sources/funding/just-transition-fund/case-study-regional-observatory-transition-process-silesia.pdf" },
      { title: "European Commission, Support to the implementation of just transition in Poland", url: "https://reforms-investments.ec.europa.eu/technical-support-instrument-0/green-transition/support-implementation-just-transition-poland_en" },
      { title: "IEA, Poland's just transition for coal workers", url: "https://www.iea.org/policies/17726-polands-just-transition-for-coal-workers" },
      { title: "World Bank, Support for Polish Coal Regions in Transition", url: "https://www.worldbank.org/en/country/poland/publication/support-for-polish-coal-regions-in-transition" },
    ] },
  { name: "EU ETS2 · 사회기후기금", region: "EU", source: "team",
    s: { d1: 2, d2: "X", d3: 2, p1: 2, p2: 2, p3: 2, r1: 2, r2: "X", r3: "X" },
    refs: [
      { title: "Regulation (EU) 2023/955 establishing a Social Climate Fund (EUR-Lex)", url: "https://eur-lex.europa.eu/eli/reg/2023/955/oj/eng" },
      { title: "European Commission, About the EU ETS", url: "https://climate.ec.europa.eu/eu-action/carbon-markets/about-eu-ets_en" },
      { title: "European Commission, Social Climate Fund", url: "https://employment-social-affairs.ec.europa.eu/policies-and-activities/funding/social-climate-fund_en" },
      { title: "European Commission, Social Climate Fund National Plans", url: "https://employment-social-affairs.ec.europa.eu/policies-and-activities/funding/social-climate-fund/social-climate-fund-national-plans_en" },
      { title: "European Commission, Social Climate Fund – Programme performance statement", url: "https://commission.europa.eu/strategy-and-policy/eu-budget/performance-and-reporting/programme-performance-statements/social-climate-fund_en" },
      { title: "European Commission, EU Climate Action Progress Report 2026, Chapter 7", url: "https://climate.ec.europa.eu/areas-action/climate-strategies-targets/progress-climate-action/eu-climate-action-progress-report-2026/chapter-7-investments-climate-action_en" },
      { title: "European Parliament, Answer to Parliamentary Question E-002023/2025", url: "https://www.europarl.europa.eu/doceo/document/E-10-2025-002023-ASW_EN.pdf" },
    ] },
  { name: "남아공 JETP (JET IP)", region: "남아프리카공화국", source: "team",
    s: { d1: 0, d2: 1, d3: "X", p1: 3, p2: 3, p3: 1, r1: 1, r2: 2, r3: 1 },
    refs: [
      IEA_WEI,
      { title: "South Africa JET PMU, JET Investment Register", url: "https://justenergytransition.co.za/jet-investment-register" },
      { title: "South Africa JET PMU, JET Progress Report Dashboard (Q1 2026)", url: "https://justenergytransition.co.za/jet-progress-report-dashboard-q1-2026" },
      { title: "South Africa JET PMU, Monitoring, Evaluation and Learning", url: "https://justenergytransition.co.za/monitoring-evaluation-and-learning" },
      { title: "The Presidency of South Africa, Annual Report 2024/2025", url: "https://www.gov.za/sites/default/files/gcis_document/202511/thepresidencyannualreport2024-2025.pdf" },
      { title: "UK Government, Advancing the South Africa Just Energy Transition Partnership (COP28)", url: "https://www.gov.uk/government/news/advancing-the-south-africa-just-energy-transition-partnership" },
    ] },
  { name: "인도네시아 JETP", region: "인도네시아", source: "team",
    s: { d1: "N", d2: "N", d3: "N", p1: 2, p2: 3, p3: 1, r1: 1, r2: 1, r3: "N" },
    refs: [
      { title: "JETP Indonesia Secretariat, Comprehensive Investment and Policy Plan (CIPP) 2023", url: "https://jetp-id.org/storage/jetp-comprehensive-investment-and-policy-plan-2023-draft-for-public-consultation-en.pdf" },
      { title: "JETP Indonesia Secretariat (공식 사이트)", url: "https://jetp-id.org/" },
      { title: "JETP Indonesia, JETP Progress Report 2025 and Thematic Reports", url: "https://jetp.id/news/jetp-reports-2025" },
      { title: "JETP Indonesia, 2025 진행보고서 공개협의 결과", url: "https://jetp.id/id/berita/konsultasi-publik-laporan-kemajuan-jetp-2025-telah-selesai" },
      IEA_WEI,
    ] },
  { name: "충남 태안 (석탄화력 폐지)", region: "대한민국", source: "team",
    s: { d1: 1, d2: 1, d3: "N", p1: 2, p2: 2, p3: 1, r1: 1, r2: 2, r3: "N" },
    refs: [
      { title: "국가법령정보센터, 석탄화력발전소 노동자 및 폐지지역 지원 특별법", url: "https://www.law.go.kr/lsInfoP.do?lsiSeq=289749" },
      { title: "대한민국 정책브리핑, 태안화력 1호기 발전종료 관련 발표", url: "https://www.korea.kr/news/policyNewsView.do?newsId=148957374" },
      { title: "태안군, 노동자 역량강화 지원 협약 관련 자료", url: "https://www.taean.go.kr/cop/bbs/BBSMSTR_000000000040/selectBoardArticle.do?nttId=1514285118" },
      { title: "충청남도, 2045 탄소중립·녹색성장 실현을 위한 계획", url: "https://clik.nanet.go.kr/clikr-collection/bill/041001/12/2026/CLIKC2194056628388308_1.pdf" },
      { title: "충청남도의회, 탈석탄 지역(태안화력 중심)의 정의로운 전환 대책 마련 (자료집)", url: "https://council.chungnam.go.kr/kr/bbs/download.do?bbs_id=news&uid=36A7E2F977810A1490F369F60F099A1A" },
      { title: "충청남도의회, 제1차 충청남도 2045 탄소중립 녹색성장 기본계획 이행점검 자료", url: "https://council.chungnam.go.kr/kr/bbs/download.do?bbs_id=action&uid=850BF3044E3BB522A72E1977F3165D29" },
    ] },
];

// 채점된 지표만으로 0~100 지수. 채점된 지표가 없으면 null.
export function index(s, ids = ALL.map(i => i.id)) {
  const nums = ids.map(id => s[id]).filter(v => typeof v === "number");
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / (nums.length * 3) * 100) : null;
}

// 5단계 등급. 지수 = 평균 점수 ÷ 3 × 100이라 구간은 평균 점수 1.0·1.5·2.0·2.5에 맞춘 것이다.
// 높은 등급부터 적는다. 팀 임시안이며, 바꿀 때는 이 표만 고친다.
export const GRADES = [
  { min: 83, label: "정의 실현", tone: "g5", avg: "2.5점 이상", desc: "대부분의 지표에서 실제 집행 성과가 확인됩니다." },
  { min: 67, label: "제도적 정의", tone: "g4", avg: "2.0~2.5점", desc: "집행 체계가 갖춰졌고 일부 지표에서 성과가 보입니다." },
  { min: 50, label: "부분적 정의", tone: "g3", avg: "1.5~2.0점", desc: "집행 체계를 갖춘 지표와 선언·계획에 머문 지표가 섞여 있습니다." },
  { min: 34, label: "형식적 정의", tone: "g2", avg: "1.0~1.5점", desc: "대부분 선언·계획에 머물고 집행 체계는 드뭅니다." },
  { min: 0, label: "부정의", tone: "g1", avg: "1.0점 이하", desc: "제도가 없거나 선언조차 미흡한 지표가 대부분입니다." },
];
export function grade(idx) {
  if (idx === null) return { label: "평가 유보", tone: "na" };
  return GRADES.find(g => idx >= g.min);
}
