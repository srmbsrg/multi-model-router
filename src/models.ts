/**
 * LLM Model Registry
 *
 * Central catalogue of available models with metadata used by the router
 * to make cost/quality/speed trade-offs.
 *
 * Key design principle: models are data, not code. Adding a new model means
 * adding a row to this array — no routing logic changes required.
 *
 * The `strengths` array is used by the auto-router to match stages to models.
 * For example, a stage that deals with "complex logic" prefers models that
 * list "reasoning" as a strength.
 */

import type { LLMModelOption, PipelineStage, StageModelConfig } from './types';

export const LLM_MODELS: LLMModelOption[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    description: 'Balanced speed and quality. Excellent at code generation, architecture design, and long-form reasoning.',
    strengths: ['code generation', 'architecture', 'reasoning', 'long context'],
    speed: 'medium',
    quality: 'best',
    costTier: 'medium',
  },
  {
    id: 'gpt-4o-2024-11-20',
    name: 'GPT-4o',
    provider: 'openai',
    description: 'Fast multimodal model. Great for rapid code scaffolding and UI component generation.',
    strengths: ['fast output', 'UI components', 'versatile', 'multimodal'],
    speed: 'fast',
    quality: 'great',
    costTier: 'medium',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    description: 'Lightweight and fast. Good for simple generation tasks, quick iterations, and cost-sensitive pipelines.',
    strengths: ['speed', 'cost-effective', 'simple tasks'],
    speed: 'fast',
    quality: 'good',
    costTier: 'low',
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    provider: 'openai',
    description: 'Advanced reasoning model. Best for complex architecture decisions and intricate business logic.',
    strengths: ['deep reasoning', 'complex logic', 'architecture', 'math'],
    speed: 'slow',
    quality: 'best',
    costTier: 'high',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    description: 'Google flagship. Strong at long-context understanding, code generation, and data analysis.',
    strengths: ['long context', 'code generation', 'analysis', 'multimodal'],
    speed: 'medium',
    quality: 'best',
    costTier: 'medium',
  },
  {
    id: 'deepseek-ai/DeepSeek-R1',
    name: 'DeepSeek R1',
    provider: 'deepseek',
    description: 'Open-source reasoning model. Excellent at complex schema design and API planning.',
    strengths: ['reasoning', 'schema design', 'cost-effective', 'open-source'],
    speed: 'medium',
    quality: 'great',
    costTier: 'low',
  },
  {
    id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
    name: 'Llama 3.1 405B',
    provider: 'meta',
    description: "Meta's largest open model. Strong instruction following and code generation at lower cost.",
    strengths: ['large-scale', 'code', 'instruction following', 'cost-effective'],
    speed: 'medium',
    quality: 'great',
    costTier: 'medium',
  },
];

/** Default model assignments — tuned for a code-generation pipeline */
export const DEFAULT_STAGE_CONFIG: StageModelConfig = {
  architecture: 'claude-sonnet-4-20250514', // reasoning-heavy → Claude
  database:     'claude-sonnet-4-20250514', // schema design → Claude
  api:          'claude-sonnet-4-20250514', // business logic → Claude
  ui:           'gpt-4o-2024-11-20',        // component scaffolding → GPT-4o (faster)
  review:       'o3-mini',                  // deep code review → o3-mini
};

/** Metadata about each stage — used for UI display and routing explanations */
export const STAGE_INFO: Record<PipelineStage, { label: string; description: string }> = {
  architecture: { label: 'Architecture Design', description: 'Designs system architecture, models, and endpoint contracts' },
  database:     { label: 'Database Models',     description: 'Generates schemas, migrations, and ORM models' },
  api:          { label: 'API Routes',          description: 'Generates controllers, business logic, and API handlers' },
  ui:           { label: 'UI Components',       description: 'Generates frontend components, pages, and forms' },
  review:       { label: 'Code Review',         description: 'Reviews generated code for correctness, security, and style' },
};

/** Lookup a model by ID */
export function getModelById(id: string): LLMModelOption | undefined {
  return LLM_MODELS.find((m) => m.id === id);
}

/** Get all models that have a given strength tag */
export function getModelsByStrength(strength: string): LLMModelOption[] {
  return LLM_MODELS.filter((m) => m.strengths.some((s) => s.toLowerCase().includes(strength.toLowerCase())));
}
