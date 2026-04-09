/**
 * LLM Router
 *
 * Selects the right model for a given pipeline stage and executes the LLM call.
 *
 * Routing priority (highest to lowest):
 *  1. Explicit `preferredModelId` in the request (caller knows what they want)
 *  2. Stage-level config (operator-configured defaults per stage)
 *  3. Auto-routing heuristics based on `hints` (cost, quality, speed constraints)
 *  4. Global default fallback
 *
 * The gate check runs before every call. If the gate is closed (budget exceeded,
 * rate limit hit, stage not allowed), the call is rejected immediately — no LLM
 * call is made. This is the primary cost-control mechanism.
 *
 * All decisions are logged to an in-memory ring buffer (max 1000 entries).
 * Call `getRouterStats()` for aggregate metrics.
 */

import type {
  RoutingRequest,
  RoutingDecision,
  LLMResponse,
  RouterStats,
  StageModelConfig,
} from './types';
import { LLM_MODELS, DEFAULT_STAGE_CONFIG, getModelById } from './models';
import { checkGate, recordTokenUsage } from './gate';

// ---------------------------------------------------------------------------
// Per-stage model configuration — can be overridden at runtime
// ---------------------------------------------------------------------------
let stageConfig: StageModelConfig = { ...DEFAULT_STAGE_CONFIG };

export function updateStageConfig(updates: Partial<StageModelConfig>): void {
  stageConfig = { ...stageConfig, ...updates };
}

export function getStageConfig(): StageModelConfig {
  return { ...stageConfig };
}

// ---------------------------------------------------------------------------
// Decision log — ring buffer for stats and debugging
// ---------------------------------------------------------------------------
const decisionLog: RoutingDecision[] = [];
const LOG_LIMIT = 1000;

// ---------------------------------------------------------------------------
// MAIN: route a request and execute the LLM call
// ---------------------------------------------------------------------------

/**
 * Route a prompt to the appropriate model based on stage config and hints,
 * then execute the LLM call.
 *
 * Returns the full LLM response including token usage and latency.
 * Throws if the gate is closed or the LLM call fails.
 */
export async function routeAndCall(
  request: RoutingRequest,
  baseURL: string,
  apiKey: string
): Promise<{ decision: RoutingDecision; response: LLMResponse }> {
  // 1. Gate check — fail fast before spending any money
  const gate = checkGate(request.stage);
  if (!gate.open) {
    throw new Error(`LLM gate closed for stage "${request.stage}": ${gate.reason}`);
  }

  // 2. Select model
  const decision = selectModel(request);
  logDecision(decision);

  // 3. Execute LLM call
  const startMs = Date.now();
  const raw = await callLLMDirect(request.prompt, {
    model: decision.model.id,
    apiKey,
    baseURL,
    maxTokens: 4096,
    temperature: 0.7,
  });
  const latencyMs = Date.now() - startMs;

  const response: LLMResponse = { ...raw, latencyMs };

  // 4. Record usage against the gate
  recordTokenUsage(request.stage, response.tokensUsed);

  return { decision, response };
}

// ---------------------------------------------------------------------------
// Model selection logic
// ---------------------------------------------------------------------------

export function selectModel(request: RoutingRequest): RoutingDecision {
  let modelId: string;
  let reason: string;

  if (request.preferredModelId) {
    // Highest priority: explicit override
    modelId = request.preferredModelId;
    reason = 'caller-specified model override';
  } else if (stageConfig[request.stage]) {
    // Second: stage-level configured default
    modelId = stageConfig[request.stage];
    reason = `stage-level config for "${request.stage}"`;
  } else if (request.hints) {
    // Third: heuristic auto-routing
    const { modelId: autoId, reason: autoReason } = autoRoute(request);
    modelId = autoId;
    reason = autoReason;
  } else {
    // Fallback
    modelId = DEFAULT_STAGE_CONFIG[request.stage] ?? LLM_MODELS[0].id;
    reason = 'global default fallback';
  }

  const model = getModelById(modelId);
  if (!model) {
    // Unknown model ID — use first available model to avoid hard crash
    const fallback = LLM_MODELS[0];
    return {
      model: fallback,
      stage: request.stage,
      reason: `unknown model "${modelId}", fell back to ${fallback.name}`,
      timestamp: new Date().toISOString(),
    };
  }

  return { model, stage: request.stage, reason, timestamp: new Date().toISOString() };
}

/**
 * Heuristic auto-router — scores every available model against the request hints
 * and picks the best match. This is intentionally simple: a more sophisticated
 * version would use a scoring matrix or ML-based predictor.
 */
function autoRoute(request: RoutingRequest): { modelId: string; reason: string } {
  const hints = request.hints ?? {};
  const costRank = { low: 0, medium: 1, high: 2 };
  const qualityRank = { good: 0, great: 1, best: 2 };

  const candidates = LLM_MODELS.filter((m) => {
    if (hints.maxCostTier && costRank[m.costTier] > costRank[hints.maxCostTier]) return false;
    if (hints.minQuality && qualityRank[m.quality] < qualityRank[hints.minQuality]) return false;
    return true;
  });

  if (candidates.length === 0) {
    return { modelId: LLM_MODELS[0].id, reason: 'no candidates after filtering, used first available' };
  }

  // If speed is preferred, sort by speed (fast first); otherwise sort by quality
  const speedRank = { fast: 0, medium: 1, slow: 2 };
  const sorted = [...candidates].sort((a, b) =>
    hints.preferSpeed
      ? speedRank[a.speed] - speedRank[b.speed]
      : qualityRank[b.quality] - qualityRank[a.quality]
  );

  const chosen = sorted[0];
  return {
    modelId: chosen.id,
    reason: `auto-routed: cost≤${hints.maxCostTier ?? 'any'} quality≥${hints.minQuality ?? 'any'} speed=${hints.preferSpeed ? 'preferred' : 'not prioritised'} → ${chosen.name}`,
  };
}

// ---------------------------------------------------------------------------
// Direct LLM call — OpenAI-compatible API
// ---------------------------------------------------------------------------

async function callLLMDirect(
  prompt: string,
  opts: { model: string; apiKey: string; baseURL: string; maxTokens?: number; temperature?: number; systemPrompt?: string }
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(`${opts.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content ?? '',
    model: data.model ?? opts.model,
    tokensUsed: data.usage?.total_tokens ?? 0,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    finishReason: choice?.finish_reason ?? 'unknown',
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function logDecision(d: RoutingDecision): void {
  decisionLog.push(d);
  if (decisionLog.length > LOG_LIMIT) decisionLog.shift();
}

export function getRouterStats(): RouterStats {
  const modelBreakdown: RouterStats['modelBreakdown'] = {};
  const stageBreakdown: RouterStats['stageBreakdown'] = {};
  let totalTokens = 0;
  let totalLatency = 0;
  let latencyCount = 0;

  for (const d of decisionLog) {
    const mKey = d.model.id;
    if (!modelBreakdown[mKey]) modelBreakdown[mKey] = { requests: 0, tokens: 0 };
    modelBreakdown[mKey].requests++;

    const sKey = d.stage;
    if (!stageBreakdown[sKey]) stageBreakdown[sKey] = { requests: 0, tokens: 0 };
    stageBreakdown[sKey].requests++;
  }

  return {
    totalRequests: decisionLog.length,
    totalTokens,
    modelBreakdown,
    stageBreakdown,
    avgLatencyMs: latencyCount > 0 ? totalLatency / latencyCount : 0,
  };
}

export function getDecisionLog(): RoutingDecision[] {
  return [...decisionLog];
}
