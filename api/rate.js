import { AXES, ALL, LEVELS } from "../indicators.js";

// 1) Tavily로 웹 검색(무료 월 1,000크레딧, 1회 1크레딧) → 2) 무료 Gemini가 그 문서만 근거로 채점.
// Gemini 무료 등급은 Google 검색 연동이 안 돼서 검색을 따로 한다.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const LITE = "gemini-3.5-flash-lite";
// [모델, 제한 ms]. 503·429·시간 초과면 다음 모델로. 합계(30+20+140+90초)는 Vercel 제한 300초 안.
const PLAN_MODELS = [[LITE, 30000]];
const RATE_MODELS = [[MODEL, 140000], [LITE, 90000]];
const SEARCH_MS = 20000;

// 측정 1건 = 검색 4회. 검색어는 Gemini가 공식 정책명(영어·현지어)으로 만들고, 실패하면 고정 키워드를 쓴다.
const FALLBACK = [
  "",
  "just transition fund budget subsidy workers support energy poverty",
  "stakeholder consultation transparency independent monitoring evaluation report",
  "vulnerable groups women indigenous informal workers community dependence",
];
const DOC_CHARS = 3000;
// Tavily 관련도(score, 0~1) 순으로 최대 MAX_DOCS건, MIN_SCORE 미만은 버리되 최소 MIN_DOCS건은 남긴다.
// ponytail: 고정 임계값, 실제 점수 분포를 보고 조정한다.
const MAX_DOCS = 12, MIN_DOCS = 5, MIN_SCORE = 0.3;

const PLANNER = `기후정의 평가를 위해 사례를 조사할 웹 검색어 4개를 만든다.
- 사례의 공식 정책·법령·계획 이름을 영어로 쓰고, 현지 언어 공식 명칭이 있으면 함께 쓴다. 한국 사례는 한국어로 쓴다.
- 4개는 각각 다음을 겨냥한다: 1) 정책 개요·법령 원문, 2) 재원·보조금·노동자 지원·에너지 부담, 3) 이해관계자 참여·정보 공개·독립 평가 보고서, 4) 취약집단·지역 의존도·전환 이후 추적.
- 모든 검색어에 정책명이나 지역명을 반드시 넣는다. "independent evaluation report"처럼 사례와 무관한 일반 문서가 걸리는 검색어는 쓰지 않는다.
- 검색어마다 12단어 이내.
JSON 하나만 출력한다: {"queries": ["...", "...", "...", "..."]}`;

const rubric = AXES.map(a =>
  `## ${a.name}\n` + a.indicators.map(i => `- ${i.id} ${i.name}: ${i.rule}`).join("\n")
).join("\n\n");

const SYSTEM = `당신은 기후정의 지표로 정책·사례를 평가하는 연구 보조원이다.
사용자가 사례와 함께 웹 검색으로 찾은 문서 목록을 준다. 그 문서들만 근거로 아래 9개 지표를 채점한다. 문서에 없는 내용은 추측하지 않는다.

# 공통 채점 기준 (0~3점)
${Object.entries(LEVELS).map(([k, v]) => `${k}점: ${v}`).join("\n")}

# 지표
${rubric}

# 원칙
- 0점은 제도·계획·실적이 없다는 것을 문서로 확인했을 때만 준다. 근거 문서가 없거나 아직 시기가 안 됐으면 "N"(자료 부족)으로 한다.
- 제도 구조상 대상이 없으면 "X"(해당 없음)로 한다. 예: 가구 대상 제도에서 노동자 추적.
- 3점은 실제 집행·결과가 문서로 확인될 때만. 계획·법령만 있으면 2점 이하.
- 확신이 없으면 낮은 점수를 준다. 근거로 쓴 문서의 URL을 목록에 적힌 그대로 sources에 넣는다.
- 평가 단위는 전환 정책·계획 1건이다. 사례가 넓으면 가장 대표적인 정책 하나로 좁히고 case.scope에 적는다.
- 모든 설명은 한국어로 쓴다.

# 출력
아래 형식의 JSON 하나만 출력한다. 앞뒤에 다른 글을 쓰지 않는다.
{
  "case": { "name": "사례 이름", "region": "국가·지역", "scope": "평가한 정책 1건과 기간", "summary": "사례 요약 2~3문장" },
  "scores": [ { "id": "d1", "score": 0|1|2|3|"N"|"X", "reason": "판정 근거 1~3문장", "sources": [ { "title": "문서명", "url": "https://..." } ] } ],
  "confidence": "높음"|"보통"|"낮음",
  "note": "가장 큰 부정의 지점과 자료 공백 2~3문장"
}
scores에는 ${ALL.map(i => i.id).join(", ")} 9개를 모두 넣는다.`;

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 가능합니다." });

  const name = String(req.body?.name ?? "").trim();
  const context = String(req.body?.context ?? "").trim();
  if (!name || name.length > 200 || context.length > 2000) {
    return res.status(400).json({ error: "사례 이름(200자 이내)과 설명(2000자 이내)을 확인해 주세요." });
  }
  const missing = ["TAVILY_API_KEY", "GEMINI_API_KEY"].filter(k => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ error: `서버에 ${missing.join(", ")}가 설정되지 않았습니다.` });
  }

  try {
    const caseText = `평가할 사례: ${name}` + (context ? `\n추가 설명: ${context}` : "");
    const queries = await planQueries(name, caseText);
    const docs = await searchAll(queries);
    if (!docs.length) return res.status(404).json({ error: "이 사례로 검색된 문서가 없습니다. 사례 이름을 더 구체적으로(영문 정책명 등) 적어 보세요." });

    const list = docs.map((d, i) => `[${i + 1}] ${d.title}\nURL: ${d.url}\n${d.text}`).join("\n\n---\n\n");
    const text = await gemini(SYSTEM, `${caseText}\n\n# 검색된 문서 (${docs.length}건)\n\n${list}`, RATE_MODELS);
    const out = clean(parseJson(text), new Set(docs.map(d => d.url)));
    out.refs = docs.map(({ title, url, score }) => ({ title, url, score }));
    out.queries = queries;
    return res.status(200).json(out);
  } catch (err) {
    console.error(err);
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
    return res.status(502).json({ error: err instanceof SyntaxError
      ? "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요."
      : "AI 평가 중 오류가 났습니다. 잠시 후 다시 시도해 주세요." });
  }
}

async function gemini(system, user, models) {
  for (const [i, [model, ms]] of models.entries()) {
    const last = i === models.length - 1;
    let r, data;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
        }),
        signal: AbortSignal.timeout(ms),
      });
      if (r.ok) data = await r.json();
    } catch (err) {
      if (err.name !== "TimeoutError") throw err;
      console.error("gemini timeout", model);
      if (last) throw new ApiError(504, "AI 응답이 너무 늦습니다. 잠시 후 다시 시도해 주세요.");
      continue;
    }
    if ((r.status === 503 || r.status === 429) && !last) { console.error("gemini", r.status, model); continue; }
    if (r.status === 429) throw new ApiError(429, "AI 무료 사용량을 다 썼거나 요청이 몰렸습니다. 잠시 후(또는 내일) 다시 시도해 주세요.");
    if (!r.ok) { console.error("gemini", r.status, model, await r.text()); throw new ApiError(502, `AI 평가 중 오류가 났습니다 (Gemini ${r.status}).`); }
    const cand = data.candidates?.[0];
    return (cand?.content?.parts ?? []).map(p => p.text ?? "").join("");
  }
}

export async function planQueries(name, caseText) {
  try {
    const q = (parseJson(await gemini(PLANNER, caseText, PLAN_MODELS)).queries ?? [])
      .map(s => String(s ?? "").trim()).filter(Boolean).slice(0, 4);
    if (q.length) return q;
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) throw err;
    console.error("planner", err);
  }
  return FALLBACK.map(k => `${name} ${k}`.trim());
}

async function searchAll(queries) {
  const results = await Promise.all(queries.map(q => tavily(q)));
  const seen = new Set();
  const docs = results.flat()
    .filter(d => /^https?:\/\//i.test(d.url) && !seen.has(d.url) && seen.add(d.url))
    .sort((a, b) => b.score - a.score);
  return docs.filter((d, i) => i < MIN_DOCS || d.score >= MIN_SCORE).slice(0, MAX_DOCS);
}

async function tavily(query) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query: query.slice(0, 400), search_depth: "basic", max_results: 5, include_raw_content: "text" }),
    signal: AbortSignal.timeout(SEARCH_MS),
  }).catch(err => {
    if (err.name === "TimeoutError") throw new ApiError(504, "웹 검색이 너무 늦습니다. 잠시 후 다시 시도해 주세요.");
    throw err;
  });
  if ([429, 432, 433].includes(r.status)) throw new ApiError(429, "이번 달 무료 검색 한도를 다 썼거나 요청이 몰렸습니다. 잠시 후(또는 다음 달) 다시 시도해 주세요.");
  if (!r.ok) { console.error("tavily", r.status, await r.text()); throw new ApiError(502, `웹 검색 중 오류가 났습니다 (Tavily ${r.status}).`); }
  return ((await r.json()).results ?? []).map(x => ({
    title: String(x.title || x.url).slice(0, 200),
    url: String(x.url ?? "").slice(0, 1000),
    score: Number(x.score) || 0,
    text: String(x.raw_content || x.content || "").slice(0, DOC_CHARS),
  }));
}

export function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new SyntaxError("no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

// 모델 출력은 신뢰하지 않는다: 점수는 허용값만, 링크는 실제 검색된 URL만 남긴다.
export function clean(r, allowed) {
  const byId = Object.fromEntries((r.scores ?? []).map(s => [s.id, s]));
  const str = (v, max = 1000) => String(v ?? "").slice(0, max);
  return {
    case: {
      name: str(r.case?.name, 200), region: str(r.case?.region, 100),
      scope: str(r.case?.scope, 300), summary: str(r.case?.summary),
    },
    s: Object.fromEntries(ALL.map(({ id }) => {
      const v = byId[id]?.score;
      return [id, [0, 1, 2, 3, "N", "X"].includes(v) ? v : "N"];
    })),
    detail: Object.fromEntries(ALL.map(({ id }) => [id, {
      reason: str(byId[id]?.reason),
      sources: (byId[id]?.sources ?? [])
        .filter(s => /^https?:\/\//i.test(s?.url ?? "") && (!allowed || allowed.has(s.url)))
        .slice(0, 5)
        .map(s => ({ title: str(s.title || s.url, 200), url: str(s.url, 500) })),
    }])),
    confidence: ["높음", "보통", "낮음"].includes(r.confidence) ? r.confidence : "낮음",
    note: str(r.note),
  };
}
