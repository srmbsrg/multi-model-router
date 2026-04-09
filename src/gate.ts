/**
 * LLM Token Gate
 *
 * Enforces two hard limits before any LLM call is allowed through:
 *
 *  1. Daily token budget   — cumulative tokens across ALL stages reset at midnight UTC
 *  2. Per-minute rate      — simple in-memory sliding window counter
 *
 * Additionally, each stage can be individually enabled/disabled. This lets you
 * enable expensive models for production while keeping them off in CI.
 *
 * In production, replace the in-memory counters with Redis atomics (INCR + EXPIRE)
 * to enforce limits correctly across multiple instances.
 *
 * Design rationale
 * ────────────────
 * The gate is intentionally coarse — it doesn't know about individual users or
 * tenants. A more sophisticated system would layer per-tenant limits on top. The
 * value of this simple gate is that it's a hard stop: if you misconfigure a
 * prompt loop and start burning tokens, the gate will cut it off within a minute.
 */

import type { GateConfig, GateStatus, PipelineStage } from './types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let gateConfig: GateConfig = {
  enabled: true,
  dailyTokenBudget: 500_000,     // 500k tokens/day — adjust for your cost tolerance
  requestsPerMinute: 60,
  allowedStages: ['architecture', 'database', 'api', 'ui', 'review'],
};

// Usage counters
let tokensToday = 0;
let lastDayReset = new Date();
let requestsThisMinute = 0;
let lastMinuteReset = new Date();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check whether the gate allows a call for the given stage */
export function checkGate(stage: PipelineStage): GateStatus {
  if (!gateConfig.enabled) {
    return { open: true, tokensConsumedToday: tokensToday, requestsThisMinute, config: gateConfig };
  }

  // Reset daily counter at midnight UTC
  const now = new Date();
  if (now.getUTCDate() !== lastDayReset.getUTCDate()) {
    tokensToday = 0;
    lastDayReset = now;
  }

  // Reset per-minute counter
  if (now.getTime() - lastMinuteReset.getTime() > 60_000) {
    requestsThisMinute = 0;
    lastMinuteReset = now;
  }

  // Stage allowed?
  if (!gateConfig.allowedStages.includes(stage)) {
    return {
      open: false,
      tokensConsumedToday: tokensToday,
      requestsThisMinute,
      config: gateConfig,
      reason: `Stage "${stage}" is not in the allowed stages list`,
    };
  }

  // Daily budget exceeded?
  if (tokensToday >= gateConfig.dailyTokenBudget) {
    return {
      open: false,
      tokensConsumedToday: tokensToday,
      requestsThisMinute,
      config: gateConfig,
      reason: `Daily token budget exhausted (${tokensToday.toLocaleString()} / ${gateConfig.dailyTokenBudget.toLocaleString()})`,
    };
  }

  // Rate limit exceeded?
  if (requestsThisMinute >= gateConfig.requestsPerMinute) {
    return {
      open: false,
      tokensConsumedToday: tokensToday,
      requestsThisMinute,
      config: gateConfig,
      reason: `Rate limit exceeded (${requestsThisMinute} / ${gateConfig.requestsPerMinute} rpm)`,
    };
  }

  requestsThisMinute++;
  return { open: true, tokensConsumedToday: tokensToday, requestsThisMinute, config: gateConfig };
}

/** Record token consumption after a successful LLM call */
export function recordTokenUsage(stage: PipelineStage, tokens: number): void {
  tokensToday += tokens;
  console.log(
    `[Gate] stage=${stage} tokens_this_call=${tokens} tokens_today=${tokensToday}/${gateConfig.dailyTokenBudget}`
  );
}

/** Update gate configuration at runtime */
export function updateGateConfig(updates: Partial<GateConfig>): void {
  gateConfig = { ...gateConfig, ...updates };
}

/** Snapshot of current gate state */
export function getGateStatus(): GateStatus {
  return checkGate('architecture'); // uses any allowed stage for a read-only check
}

/** Reset all counters (useful for testing) */
export function resetCounters(): void {
  tokensToday = 0;
  requestsThisMinute = 0;
  lastDayReset = new Date();
  lastMinuteReset = new Date();
}
