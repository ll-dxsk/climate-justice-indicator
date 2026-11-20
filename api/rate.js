import { AXES, ALL, LEVELS } from "../indicators.js";

// 1) Tavily로 웹 검색(무료 월 1,000크레딧, 1회 1크레딧) → 2) 무료 Gemini가 그 문서만 근거로 채점.
// Gemini 무료 등급은 Google 검색 연동이 안 돼서 검색을 따로 한다.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// 측정 1건 = 검색 4회. ponytail: 고정 키워드, 결과가 얇으면 지표별 검색으로 늘린다.
const QUERIES = [
  "",
  "just transition fund budget subsidy workers support energy poverty",
  "stakeholder consultation transparency independent monitoring evaluation report",
  "vulnerable groups women indigenous informal workers community dependence",
];
const DOC_CHARS = 3000;

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
    const docs = await searchAll(name);
    if (!docs.length) return res.status(404).json({ error: "이 사례로 검색된 문서가 없습니다. 사례 이름을 더 구체적으로(영문 정책명 등) 적어 보세요." });

    const list = docs.map((d, i) => `[${i + 1}] ${d.title}\nURL: ${d.url}\n${d.text}`).join("\n\n---\n\n");
    const r = await fetch(GEMINI, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text:
          `평가할 사례: ${name}` + (context ? `\n추가 설명: ${context}` : "") + `\n\n# 검색된 문서 (${docs.length}건)\n\n${list}` }] }],
      }),
    });
    if (r.status === 429) throw new ApiError(429, "AI 무료 사용량을 다 썼거나 요청이 몰렸습니다. 잠시 후(또는 내일) 다시 시도해 주세요.");
    if (!r.ok) { console.error("gemini", r.status, await r.text()); throw new ApiError(502, `AI 평가 중 오류가 났습니다 (Gemini ${r.status}).`); }

    const cand = (await r.json()).candidates?.[0];
    const text = (cand?.content?.parts ?? []).map(p => p.text ?? "").join("");
    const out = clean(parseJson(text), new Set(docs.map(d => d.url)));
    out.refs = docs.map(({ title, url }) => ({ title, url }));
    return res.status(200).json(out);
  } catch (err) {
    console.error(err);
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
    return res.status(502).json({ error: err instanceof SyntaxError
      ? "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요."
      : "AI 평가 중 오류가 났습니다. 잠시 후 다시 시도해 주세요." });
  }
}

async function searchAll(name) {
  const results = await Promise.all(QUERIES.map(q => tavily(`${name} ${q}`.trim())));
  const seen = new Set();
  return results.flat().filter(d => /^https?:\/\//i.test(d.url) && !seen.has(d.url) && seen.add(d.url));
}

async function tavily(query) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query: query.slice(0, 400), search_depth: "basic", max_results: 5, include_raw_content: "text" }),
  });
  if ([429, 432, 433].includes(r.status)) throw new ApiError(429, "이번 달 무료 검색 한도를 다 썼거나 요청이 몰렸습니다. 잠시 후(또는 다음 달) 다시 시도해 주세요.");
  if (!r.ok) { console.error("tavily", r.status, await r.text()); throw new ApiError(502, `웹 검색 중 오류가 났습니다 (Tavily ${r.status}).`); }
  return ((await r.json()).results ?? []).map(x => ({
    title: String(x.title || x.url).slice(0, 200),
    url: String(x.url ?? "").slice(0, 1000),
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
