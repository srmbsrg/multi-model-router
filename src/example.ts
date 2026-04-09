/**
 * example.ts — Runnable demo of the multi-model router
 *
 * Demonstrates:
 *  1. Stage-based model selection using the configured defaults
 *  2. Auto-routing based on cost/quality hints
 *  3. Runtime stage config overrides
 *  4. Gate inspection and forced gate closure
 *
 * Run with: npx ts-node src/example.ts
 * (No real API call is made — we mock the LLM fetch for the demo)
 */

import { selectModel, updateStageConfig, getStageConfig, getRouterStats } from './router';
import { checkGate, recordTokenUsage, updateGateConfig, resetCounters } from './gate';
import { LLM_MODELS, getModelsByStrength } from './models';
import type { RoutingRequest } from './types';

function printDecision(label: string, req: RoutingRequest) {
  const decision = selectModel(req);
  console.log(`\n  [${label}]`);
  console.log(`    Stage:  ${req.stage}`);
  console.log(`    Model:  ${decision.model.name} (${decision.model.id})`);
  console.log(`    Reason: ${decision.reason}`);
  console.log(`    Speed:  ${decision.model.speed}  Quality: ${decision.model.quality}  Cost: ${decision.model.costTier}`);
}

async function main() {
  console.log('\n=== Multi-Model Router Demo ===\n');
  resetCounters();

  // ── 1. Default stage-based routing ─────────────────────────────────────
  console.log('1. Default stage config routing:');
  printDecision('architecture stage', { stage: 'architecture', prompt: 'Design the system' });
  printDecision('ui stage (faster model)', { stage: 'ui', prompt: 'Generate a form component' });
  printDecision('review stage (deep reasoner)', { stage: 'review', prompt: 'Review this code' });

  // ── 2. Explicit model override ──────────────────────────────────────────
  console.log('\n2. Caller-pinned model override:');
  printDecision('forced DeepSeek', {
    stage: 'database',
    prompt: 'Design the schema',
    preferredModelId: 'deepseek-ai/DeepSeek-R1',
  });

  // ── 3. Auto-routing with hints ──────────────────────────────────────────
  console.log('\n3. Auto-routing with hints:');
  printDecision('cost-sensitive (low tier only)', {
    stage: 'ui',
    prompt: 'Generate a button component',
    hints: { maxCostTier: 'low' },
  });
  printDecision('quality-first (best quality)', {
    stage: 'architecture',
    prompt: 'Design a distributed event sourcing system',
    hints: { minQuality: 'best' },
  });
  printDecision('speed-first', {
    stage: 'api',
    prompt: 'Generate a CRUD endpoint',
    hints: { preferSpeed: true },
  });

  // ── 4. Runtime config override ──────────────────────────────────────────
  console.log('\n4. Runtime stage config override (switch UI to Gemini):');
  updateStageConfig({ ui: 'gemini-2.5-pro' });
  printDecision('ui after override', { stage: 'ui', prompt: 'Generate a dashboard' });
  // Reset
  updateStageConfig({ ui: 'gpt-4o-2024-11-20' });

  // ── 5. Gate demo ────────────────────────────────────────────────────────
  console.log('\n5. Gate behaviour:');
  const openGate = checkGate('architecture');
  console.log(`  Gate open: ${openGate.open}  tokens_today: ${openGate.tokensConsumedToday}`);

  // Simulate consuming 490k tokens
  for (let i = 0; i < 49; i++) recordTokenUsage('api', 10_000);
  const nearLimit = checkGate('api');
  console.log(`  Near-limit gate: open=${nearLimit.open}  tokens_today=${nearLimit.tokensConsumedToday}`);

  // Close the gate by exceeding budget
  recordTokenUsage('api', 20_000);
  const closedGate = checkGate('api');
  console.log(`  Closed gate: open=${closedGate.open}  reason="${closedGate.reason}"`);

  resetCounters();

  // ── 6. Model catalogue queries ──────────────────────────────────────────
  console.log('\n6. Model catalogue queries:');
  const reasoningModels = getModelsByStrength('reasoning');
  console.log(`  Models with "reasoning" strength: ${reasoningModels.map((m) => m.name).join(', ')}`);

  const fastModels = LLM_MODELS.filter((m) => m.speed === 'fast');
  console.log(`  Fast models: ${fastModels.map((m) => m.name).join(', ')}`);

  const cheapBest = LLM_MODELS.filter((m) => m.costTier === 'low' && m.quality !== 'good');
  console.log(`  Low-cost + better-than-good quality: ${cheapBest.map((m) => m.name).join(', ')}`);

  // ── Stats ────────────────────────────────────────────────────────────────
  console.log('\n7. Router stats:');
  const stats = getRouterStats();
  console.log(`  Total routing decisions: ${stats.totalRequests}`);
  console.log('  Model breakdown:', JSON.stringify(stats.modelBreakdown, null, 4));

  console.log('\n=== Done ===\n');
}

main().catch(console.error);
