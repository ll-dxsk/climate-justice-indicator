import { AXES, ALL, LEVELS } from "../indicators.js";

// 1) Tavily로 웹 검색(무료 월 1,000크레딧, 1회 1크레딧) → 2) 무료 Gemini가 그 문서만 근거로 채점.
// Gemini 무료 등급은 Google 검색 연동이 안 돼서 검색을 따로 한다.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// 무료 Gemini는 503·응답 끊김이 잦아서, 무료 등급 모델 여러 개를 빠른 순서로 차례로 시도한다.
// [모델, 최대 ms]. 실제 제한은 남은 시간(PLAN_MS·RATE_DEADLINE_MS)과 둘 중 작은 값.
const PLAN_MODELS = [["gemini-3.5-flash-lite", 15000], ["gemini-3.1-flash-lite", 15000]];
const RATE_MODELS = [["gemini-3.5-flash-lite", 70000], ["gemini-3.1-flash-lite", 70000], ["gemini-3.6-flash", 90000], [MODEL, 120000]];
const PLAN_MS = 30000, SEARCH_MS = 20000;
const RATE_DEADLINE_MS = 280000;  // 요청 시작부터. Vercel 함수 제한 300초 안에서 끝나도록.
const RETRY_STATUS = new Set([404, 429, 500, 502, 503, 504]);

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
- 모든 설명(summary, reason, note)은 한국어 합니다체로 쓴다. 문장 끝을 "-입니다", "-습니다"로 맺고 "-이다", "-한다"는 쓰지 않는다.

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

  // 여기부터는 한 줄에 JSON 하나씩(NDJSON) 진행 단계를 흘려보낸다. 마지막 줄은 {result} 또는 {error}.
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  const send = o => res.write(JSON.stringify(o) + "\n");
  const t0 = Date.now();
  try {
    const caseText = `평가할 사례: ${name}` + (context ? `\n추가 설명: ${context}` : "");
    send({ step: "plan" });
    const queries = await planQueries(name, caseText, why => send({ step: "plan-fallback", why }));
    send({ step: "search", queries });
    const docs = await searchAll(queries);
    if (!docs.length) throw new ApiError(404, "이 사례로 검색된 문서가 없습니다. 사례 이름을 더 구체적으로(영문 정책명 등) 적어 보세요.");
    send({ step: "read", n: docs.length });

    const list = docs.map((d, i) => `[${i + 1}] ${d.title}\nURL: ${d.url}\n${d.text}`).join("\n\n---\n\n");
    const seen = new Set();
    const rated = await gemini(SYSTEM, `${caseText}\n\n# 검색된 문서 (${docs.length}건)\n\n${list}`, RATE_MODELS, t0 + RATE_DEADLINE_MS, {
      // 모델이 쓰는 JSON에 지표 id가 나타날 때마다 "그 지표 채점 중"으로 알린다.
      onText: t => { for (const [, id] of t.matchAll(/"id"\s*:\s*"([dpr][1-3])"/g)) if (!seen.has(id)) { seen.add(id); send({ step: "axis", id }); } },
      onRetry: (model, why) => { seen.clear(); send({ step: "retry", model, why }); },
    });
    const out = clean(rated, new Set(docs.map(d => d.url)));
    out.refs = docs.map(({ title, url, score }) => ({ title, url, score }));
    out.queries = queries;
    send({ result: out });
  } catch (err) {
    console.error(err);
    send({ error: err instanceof ApiError ? err.message : err instanceof SyntaxError
      ? `AI 응답을 해석하지 못했습니다 (${err.message}). 다시 시도해 주세요.`
      : "AI 평가 중 오류가 났습니다. 잠시 후 다시 시도해 주세요." });
  }
  res.end();
}

const partsText = d => (d?.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("");

// JSON으로 답하게 하고, 파싱한 객체를 돌려준다. RETRY_STATUS·시간 초과·깨진 JSON이면 다음 모델로.
// deadline(절대 시각)을 넘기지 않도록 각 모델의 제한 시간을 줄이고, 5초도 안 남으면 멈춘다.
// hooks.onText가 있으면 스트리밍(SSE)으로 받아 지금까지 쓴 글 전체를 넘겨준다.
async function gemini(system, user, models, deadline, hooks = {}) {
  let lastErr;
  for (const [i, [model, cap]] of models.entries()) {
    const ms = Math.min(cap, deadline - Date.now());
    if (ms < 5000) break;
    // why: 다음 모델로 넘어간 이유(503·429·timeout·bad-json:<finishReason>). 진행 이벤트와 로그에 남긴다.
    const next = why => { console.error("gemini fallback", model, why); if (models[i + 1]) hooks.onRetry?.(models[i + 1][0], why); };
    let r, text, finish;
    try {
      const method = hooks.onText ? "streamGenerateContent?alt=sse" : "generateContent";
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(ms),
      });
      if (r.ok && hooks.onText) ({ text, finish } = await readSse(r.body, hooks.onText));
      else if (r.ok) { const d = await r.json(); text = partsText(d); finish = d.candidates?.[0]?.finishReason; }
    } catch (err) {
      if (err.name !== "TimeoutError") throw err;
      lastErr = new ApiError(504, "AI 응답이 너무 늦습니다. 잠시 후 다시 시도해 주세요.");
      next("timeout"); continue;
    }
    if (!r.ok) {
      console.error("gemini", r.status, model, (await r.text()).slice(0, 300));
      lastErr = r.status === 429
        ? new ApiError(429, "AI 무료 사용량을 다 썼거나 요청이 몰렸습니다. 잠시 후(또는 내일) 다시 시도해 주세요.")
        : new ApiError(502, `AI 평가 중 오류가 났습니다 (Gemini ${r.status}).`);
      if (!RETRY_STATUS.has(r.status)) throw lastErr;  // 400·403 등은 다른 모델로도 안 풀린다
      next(String(r.status)); continue;
    }
    try { return parseJson(text); } catch {
      console.error("gemini bad json", model, finish, text.length, text.slice(0, 200));
      lastErr = new SyntaxError(`${finish ?? "?"}, ${text.length}자`);
      next(`bad-json:${finish ?? "?"}:${text.length}`);
    }
  }
  throw lastErr ?? new ApiError(504, "AI 응답이 너무 늦습니다. 잠시 후 다시 시도해 주세요.");
}

async function readSse(body, onText) {
  const dec = new TextDecoder();
  let buf = "", text = "", finish;
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const d = JSON.parse(line.slice(5));
      text += partsText(d);
      finish = d.candidates?.[0]?.finishReason ?? d.error?.status ?? finish;  // 스트림 중간 오류도 기록
      onText(text);
    }
  }
  return { text, finish };
}

export async function planQueries(name, caseText, onFail) {
  try {
    const q = ((await gemini(PLANNER, caseText, PLAN_MODELS, Date.now() + PLAN_MS)).queries ?? [])
      .map(s => String(s ?? "").trim()).filter(Boolean).slice(0, 4);
    if (q.length) return q;
    onFail?.("빈 검색어");
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) throw err;
    console.error("planner", err);
    onFail?.(err instanceof SyntaxError ? `bad-json:${err.message}` : err.message);
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
