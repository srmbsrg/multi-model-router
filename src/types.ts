/**
 * Multi-Model Router — Core Types
 *
 * Defines the type surface for a per-stage LLM routing system.
 * Each pipeline stage can run on a different model, optimising for
 * cost, quality, or speed depending on what that stage actually needs.
 */

// ---------------------------------------------------------------------------
// Model metadata — what you know about each provider/model
// ---------------------------------------------------------------------------
export interface LLMModelOption {
  id: string;           // Provider-specific model ID (e.g. "claude-sonnet-4-20250514")
  name: string;         // Human-readable display name
  provider: string;     // Logical provider name (e.g. "anthropic", "openai", "google")
  description: string;  // One-line capability summary
  strengths: string[];  // Tags for routing hints

  // Quantitative routing hints — coarse but useful for auto-routing
  speed: 'fast' | 'medium' | 'slow';
  quality: 'good' | 'great' | 'best';
  costTier: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Pipeline stages — which part of the workflow is calling the LLM?
// ---------------------------------------------------------------------------
export type PipelineStage = 'architecture' | 'database' | 'api' | 'ui' | 'review';

/** Model assignment per pipeline stage */
export interface StageModelConfig {
  architecture: string;
  database: string;
  api: string;
  ui: string;
  review: string;
}

// ---------------------------------------------------------------------------
// Routing context — what the router receives to make a decision
// ---------------------------------------------------------------------------
export interface RoutingRequest {
  stage: PipelineStage;
  prompt: string;
  /** Optional: caller can pin a specific model, bypassing auto-routing */
  preferredModelId?: string;
  /** Routing hints that override the default auto-routing heuristics */
  hints?: {
    maxCostTier?: 'low' | 'medium' | 'high';
    minQuality?: 'good' | 'great' | 'best';
    preferSpeed?: boolean;
  };
}

export interface RoutingDecision {
  model: LLMModelOption;
  stage: PipelineStage;
  reason: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// LLM call options and response
// ---------------------------------------------------------------------------
export interface LLMCallOptions {
  model: string;
  apiKey: string;
  baseURL: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Gate — token budget enforcement
// ---------------------------------------------------------------------------
export interface GateConfig {
  enabled: boolean;
  /** Hard ceiling on total tokens consumed per day across ALL stages */
  dailyTokenBudget: number;
  /** Per-minute request ceiling (simple in-memory rate limit) */
  requestsPerMinute: number;
  /** Stages that are allowed to make LLM calls at all */
  allowedStages: PipelineStage[];
}

export interface GateStatus {
  open: boolean;
  tokensConsumedToday: number;
  requestsThisMinute: number;
  config: GateConfig;
  /** If closed, the reason why */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Router stats for observability
// ---------------------------------------------------------------------------
export interface RouterStats {
  totalRequests: number;
  totalTokens: number;
  modelBreakdown: Record<string, { requests: number; tokens: number }>;
  stageBreakdown: Record<string, { requests: number; tokens: number }>;
  avgLatencyMs: number;
}
