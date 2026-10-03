import { performance } from "node:perf_hooks";
import type { Answer, JevResponse, Questions } from "./contracts.ts";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function unit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseResponse(value: unknown, questions: Questions): JevResponse {
  if (!object(value) || typeof value.model !== "string" || !object(value.answers)) throw new Error("invalid Jev response");
  if (!object(value.usage) || !Number.isSafeInteger(value.usage.input_tokens) || !Number.isSafeInteger(value.usage.output_tokens) || Number(value.usage.input_tokens) < 0 || Number(value.usage.output_tokens) < 0) throw new Error("invalid Jev usage");
  const answers: Record<string, Answer> = {};
  if (Object.keys(value.answers).length !== Object.keys(questions).length) throw new Error("invalid answer count; missing or extra answers");
  for (const [key, question] of Object.entries(questions)) {
    const answer = value.answers[key];
    if (!object(answer) || answer.type !== question.type) throw new Error(`invalid answer ${key}`);
    if (question.type === "noul") {
      if (!unit(answer.noul)) throw new Error(`invalid noul ${key}`);
      answers[key] = { type: "noul", noul: answer.noul };
    } else {
      if (typeof answer.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice) || !unit(answer.confidence) || !object(answer.probabilities)) throw new Error(`invalid choice ${key}`);
      const options = Object.keys(question.criteria);
      const probabilities: Record<string, number> = {};
      if (Object.keys(answer.probabilities).length !== options.length) throw new Error(`invalid probabilities ${key}`);
      for (const option of options) {
        const probability = answer.probabilities[option];
        if (!unit(probability)) throw new Error(`invalid probability ${key}.${option}`);
        probabilities[option] = probability;
      }
      if (Math.abs(Object.values(probabilities).reduce((s, p) => s + p, 0) - 1) > 0.025) throw new Error(`invalid distribution ${key}`);
      const maximum = Math.max(...Object.values(probabilities));
      if (probabilities[answer.choice]! < maximum - 0.001) throw new Error(`choice is not maximum ${key}`);
      answers[key] = { type: "choice", choice: answer.choice, confidence: answer.confidence, probabilities };
    }
  }
  return { model: value.model, answers, usage: { input_tokens: Number(value.usage.input_tokens), output_tokens: Number(value.usage.output_tokens) } };
}

export interface AskOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function ask(payload: { state: unknown; questions: Questions }, options: AskOptions = {}) {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFEAI_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is required");
  if (Object.keys(payload.questions).length === 0) throw new Error("questions are required");
  const started = performance.now();
  const response = await (options.fetchImpl ?? fetch)("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: options.model ?? "jev-latest", ...payload }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  // Do not echo an untrusted HTTP error body, which could contain the credential.
  if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
  const result = parseResponse(await response.json(), payload.questions);
  return { response: result, ms: performance.now() - started };
}
