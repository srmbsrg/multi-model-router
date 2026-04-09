# multi-model-router

Per-stage multi-LLM routing with cost/quality metadata, runtime config overrides, and a token gate for budget enforcement.

Extracted and cleaned from a production AI code-generation pipeline that runs 7 different LLM providers through distinct pipeline stages.

---

## The problem it solves

Every LLM pipeline eventually faces these questions:

- "Should I use the expensive reasoning model for *every* step, or just the hard ones?"
- "How do I stop a prompt loop from burning $500 in tokens overnight?"
- "Can I switch the UI generation stage to GPT-4o without touching the architecture stage?"

Naively, teams hard-code a single model and call it done. That works until the bill arrives. This router makes model selection **a per-stage data decision** rather than a code decision — and adds a hard token gate in front of every call.

---

## Architecture

```
RoutingRequest { stage, prompt, preferredModelId?, hints? }
          │
          ▼
┌─────────────────────────────────────────────────────┐
│                   Gate (gate.ts)                     │
│  ✓ stage in allowedStages?                          │
│  ✓ tokensToday < dailyBudget?                       │
│  ✓ requestsThisMinute < rpm limit?                  │
└──────────────────────────────┬──────────────────────┘
                               │ (open)
                               ▼
┌─────────────────────────────────────────────────────┐
│                  Router (router.ts)                  │
│                                                      │
│  Priority:                                           │
│  1. preferredModelId  (caller override)              │
│  2. stageConfig[stage] (operator-set default)        │
│  3. autoRoute(hints)  (heuristic scoring)            │
│  4. global fallback                                  │
└──────────────────────────────┬──────────────────────┘
                               │
                               ▼
                  RoutingDecision { model, reason }
                               │
                               ▼
                    callLLMDirect() → LLMResponse
                               │
                               ▼
                  recordTokenUsage() → Gate counter
```

---

## File structure

```
src/
├── types.ts    — All types (LLMModelOption, PipelineStage, GateConfig, RoutingRequest…)
├── models.ts   — Model catalogue + DEFAULT_STAGE_CONFIG + getModelById / getModelsByStrength
├── gate.ts     — Token budget + rate limit enforcement
├── router.ts   — Model selection logic + LLM call execution + stats
└── example.ts  — Runnable demo
```

---

## Key technical decisions

### Why is model metadata in the registry, not the router?

The router shouldn't need to know whether `claude-sonnet-4-20250514` is fast or expensive — that's the model's data. The registry (`models.ts`) owns that metadata. The router imports it. This separation means:
- Adding a new model = one array entry, zero routing code changes
- Routing heuristics can be unit-tested without mocking LLM calls

### Why per-stage defaults instead of a single global model?

Different stages have genuinely different requirements. A code review stage benefits from a strong reasoning model. A UI scaffolding stage benefits from speed. A database schema stage benefits from precision. One model optimising all three is a compromise that costs more than needed everywhere.

### Why a daily token budget instead of per-request cost limits?

Per-request limits are easy to defeat: just send many small requests. A daily budget is a hard cumulative ceiling that catches runaway loops, regardless of request size. In production you'd use Redis `INCR` + `EXPIRE` to make this multi-instance safe.

### Why a 3-tier priority system in routing?

- Tier 1 (explicit override): the caller always knows best for their specific use case
- Tier 2 (stage config): the operator's deliberate performance/cost trade-off
- Tier 3 (auto-routing hints): the caller signals constraints without specifying a model

This prevents the common failure mode where a "smart" auto-router overrides a careful operator configuration.

### The deterministic-first pattern (from the source system)

The agent chat endpoint in the source system used a two-phase approach:
1. Run deterministic rule-based reasoning first (zero cost)
2. Only call the LLM if confidence < 0.5 AND the gate is open

This cut LLM spend by ~60% in practice. The gate here is the second half of that pattern — it enforces the budget on the LLM calls that do happen.

---

## How to run the demo

```bash
npm install
npx ts-node src/example.ts
```

Expected output shows all routing decisions with model names, reasons, cost/quality tiers, gate state changes, and model catalogue queries.

---

## Adding a new model

Edit `src/models.ts` and add an entry to `LLM_MODELS`:

```typescript
{
  id: "my-provider/my-new-model",
  name: "My New Model",
  provider: "my-provider",
  description: "...",
  strengths: ["code generation", "reasoning"],
  speed: "fast",
  quality: "great",
  costTier: "low",
}
```

That's it. No routing code changes required.

---

## Adding a new pipeline stage

1. Add the stage name to the `PipelineStage` union in `types.ts`
2. Add a default model assignment to `DEFAULT_STAGE_CONFIG` in `models.ts`
3. Add a description to `STAGE_INFO` in `models.ts`
4. Add the stage to `gateConfig.allowedStages` in `gate.ts`

---

## Where this fits in a larger system

```
User/API Request
      │
      ▼
Pipeline Orchestrator
  ├── architecture stage → Router → Claude Sonnet 4
  ├── database stage     → Router → Claude Sonnet 4
  ├── api stage          → Router → Claude Sonnet 4 (or overridden)
  ├── ui stage           → Router → GPT-4o (faster, good enough)
  └── review stage       → Router → o3-mini (deep reasoning)
                                         │
                              (each call goes through Gate first)
```

In the source system this ran as a 4-stage sequential pipeline generating full-stack applications (architecture → DB schema → API routes → UI components), with the review stage running in parallel on each generated artifact.
