import Anthropic from "@anthropic-ai/sdk";
import { AXES, ALL, LEVELS } from "../indicators.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY (Vercel 환경 변수)

const rubric = AXES.map(a =>
  `## ${a.name}\n` + a.indicators.map(i => `- ${i.id} ${i.name}: ${i.rule}`).join("\n")
).join("\n\n");

const SYSTEM = `당신은 기후정의 지표로 정책·사례를 평가하는 연구 보조원이다.
사용자가 사례를 주면 웹 검색으로 공개자료(법령, 정부·국제기구 계획, 예산·성과 보고서, 독립 평가, 신뢰할 수 있는 연구·언론)를 조사하고 아래 9개 지표를 채점한다.

# 공통 채점 기준 (0~3점)
${Object.entries(LEVELS).map(([k, v]) => `${k}점: ${v}`).join("\n")}

# 지표
${rubric}

# 원칙
- 0점은 제도·계획·실적이 없다는 것을 자료로 확인했을 때만 준다. 자료를 못 찾았거나 아직 시기가 안 됐으면 "N"(자료 부족)으로 한다.
- 제도 구조상 대상이 없으면 "X"(해당 없음)로 한다. 예: 가구 대상 제도에서 노동자 추적.
- 3점은 실제 집행·결과가 문서로 확인될 때만. 계획·법령만 있으면 2점 이하.
- 확신이 없으면 낮은 점수를 준다. 모든 점수에 근거와 출처 URL을 붙인다.
- 평가 단위는 전환 정책·계획 1건이다. 사례가 넓으면 가장 대표적인 정책 하나로 좁히고 case.scope에 적는다.
- 모든 설명은 한국어로 쓴다.

# 출력
조사를 마치면 마지막 답변에 아래 형식의 JSON 하나만 출력한다. 앞뒤에 다른 글을 쓰지 않는다.
{
  "case": { "name": "사례 이름", "region": "국가·지역", "scope": "평가한 정책 1건과 기간", "summary": "사례 요약 2~3문장" },
  "scores": [ { "id": "d1", "score": 0|1|2|3|"N"|"X", "reason": "판정 근거 1~3문장", "sources": [ { "title": "문서명", "url": "https://..." } ] } ],
  "confidence": "높음"|"보통"|"낮음",
  "note": "가장 큰 부정의 지점과 자료 공백 2~3문장"
}
scores에는 ${ALL.map(i => i.id).join(", ")} 9개를 모두 넣는다.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 가능합니다." });

  const name = String(req.body?.name ?? "").trim();
  const context = String(req.body?.context ?? "").trim();
  if (!name || name.length > 200 || context.length > 2000) {
    return res.status(400).json({ error: "사례 이름(200자 이내)과 설명(2000자 이내)을 확인해 주세요." });
  }

  const messages = [{
    role: "user",
    content: `평가할 사례: ${name}` + (context ? `\n추가 설명: ${context}` : ""),
  }];

  try {
    let msg;
    // 서버 측 웹 검색이 길어지면 pause_turn으로 멈춘다. 그대로 이어서 보낸다.
    for (let i = 0; i < 4; i++) {
      msg = await client.beta.messages.stream({
        model: "claude-opus-5-5",
        max_tokens: 32000,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 10 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
        ],
        system: SYSTEM,
        messages,
      }).finalMessage();
      if (msg.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: msg.content });
    }

    if (msg.stop_reason === "refusal") {
      return res.status(422).json({ error: "이 사례는 평가할 수 없다는 응답을 받았습니다." });
    }

    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
    return res.status(200).json(clean(parseJson(text)));
  } catch (err) {
    console.error(err);
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    return res.status(status).json({ error: err instanceof SyntaxError
      ? "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요."
      : "AI 평가 중 오류가 났습니다. 잠시 후 다시 시도해 주세요." });
  }
}

export function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new SyntaxError("no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

// 모델 출력은 신뢰하지 않는다: 점수는 허용값만, 링크는 http(s)만 남긴다.
export function clean(r) {
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
        .filter(s => /^https?:\/\//i.test(s?.url ?? ""))
        .slice(0, 5)
        .map(s => ({ title: str(s.title || s.url, 200), url: str(s.url, 500) })),
    }])),
    confidence: ["높음", "보통", "낮음"].includes(r.confidence) ? r.confidence : "낮음",
    note: str(r.note),
  };
}
