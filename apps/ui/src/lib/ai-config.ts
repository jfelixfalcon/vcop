import { k8sRequest } from './k8s-client';
import type {
  AIProviderType,
  AISettingsConfig,
  AISettingsPublic,
  AIConnectionTestResult,
} from './types';

export const AI_CONFIGMAP_NAME = 'vcop-ai-config';
export const AI_CONFIG_NAMESPACE = 'vcop-system';

export interface ProviderPreset {
  id: AIProviderType;
  name: string;
  description: string;
  defaultEndpoint: string;
  defaultModel: string;
  modelSuggestions: string[];
  apiKeyPlaceholder: string;
  helpUrl?: string;
  requiresKey: boolean;
}

export const PROVIDER_PRESETS: Record<AIProviderType, ProviderPreset> = {
  local: {
    id: 'local',
    name: 'Local Gemma 3 1B (GPU/Universal)',
    description: 'Pre-baked offline Gemma 3 1B model bundled in cluster',
    defaultEndpoint:
      process.env.AI_SERVICE_URL ||
      (process.env.KUBERNETES_SERVICE_HOST
        ? 'http://vcop-ai.vcop-system.svc:8080'
        : 'http://127.0.0.1:8088'),
    defaultModel: 'Gemma 3 1B IT (Q4_K_M)',
    modelSuggestions: ['Gemma 3 1B IT (Q4_K_M)'],
    apiKeyPlaceholder: 'None required (Offline cluster service)',
    requiresKey: false,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4o Mini, and OpenAI API endpoints',
    defaultEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    modelSuggestions: ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'gpt-4-turbo'],
    apiKeyPlaceholder: 'sk-proj-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus',
    defaultEndpoint: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    modelSuggestions: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    apiKeyPlaceholder: 'sk-ant-api03-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    requiresKey: true,
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini 1.5 Flash, Gemini 1.5 Pro, Gemini 2.0 Flash',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-1.5-flash',
    modelSuggestions: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
    apiKeyPlaceholder: 'AIzaSy...',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    requiresKey: true,
  },
  groq: {
    id: 'groq',
    name: 'Groq Cloud',
    description: 'Ultra-low-latency Llama 3.3, Llama 3.1, Mixtral',
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    modelSuggestions: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    apiKeyPlaceholder: 'gsk_...',
    helpUrl: 'https://console.groq.com/keys',
    requiresKey: true,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified multi-provider gateway for hundreds of open & proprietary models',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    modelSuggestions: [
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-flash-1.5',
      'anthropic/claude-3.5-sonnet',
      'deepseek/deepseek-chat',
    ],
    apiKeyPlaceholder: 'sk-or-v1-...',
    helpUrl: 'https://openrouter.ai/keys',
    requiresKey: true,
  },
  custom: {
    id: 'custom',
    name: 'Custom OpenAI-Compatible',
    description: 'vLLM, Ollama, TGI, LocalAI, Azure OpenAI, or Sovereign Enterprise Gateway',
    defaultEndpoint: 'http://my-llm-host:8000/v1',
    defaultModel: 'custom-model',
    modelSuggestions: [
      'meta-llama/Meta-Llama-3.1-8B-Instruct',
      'mistralai/Mistral-7B-Instruct-v0.3',
      'qwen2.5-7b-instruct',
    ],
    apiKeyPlaceholder: 'Bearer token or API key (if required)',
    requiresKey: false,
  },
};

export const DEFAULT_AI_SETTINGS: AISettingsConfig = {
  localModelEnabled: process.env.AI_LOCAL_ENABLED !== 'false',
  provider: (process.env.AI_PROVIDER as AIProviderType) || 'local',
  remoteEndpoint: process.env.AI_REMOTE_ENDPOINT || '',
  remoteModel: process.env.AI_REMOTE_MODEL || '',
  remoteApiKey: process.env.AI_API_KEY || '',
  temperature: 0.15,
  maxTokens: 800,
  updatedAt: new Date().toISOString(),
};

let configCache: AISettingsConfig | null = null;
let lastFetchTime = 0;

export function maskApiKey(apiKey?: string): string {
  if (!apiKey || apiKey.trim().length === 0) return '';
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

/**
 * Retrieves the AI settings from the Kubernetes ConfigMap or default environment variables.
 */
export async function getAISettings(): Promise<AISettingsConfig> {
  const now = Date.now();
  if (configCache && now - lastFetchTime < 3000) {
    return configCache;
  }

  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${AI_CONFIG_NAMESPACE}/configmaps/${AI_CONFIGMAP_NAME}`
    );

    if (res.statusCode === 200 && res.data?.data?.['ai-settings.json']) {
      const parsed = JSON.parse(res.data.data['ai-settings.json']) as AISettingsConfig;
      configCache = {
        ...DEFAULT_AI_SETTINGS,
        ...parsed,
        localModelEnabled: parsed.localModelEnabled ?? true,
        provider: parsed.provider || 'local',
      };
      lastFetchTime = now;
      return configCache;
    }
  } catch (err) {
    // ConfigMap not created yet, return default
  }

  configCache = { ...DEFAULT_AI_SETTINGS };
  return configCache;
}

/**
 * Returns public, sanitized AI settings safe for browser consumption.
 */
export async function getPublicAISettings(): Promise<AISettingsPublic> {
  const settings = await getAISettings();
  const preset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.local;

  return {
    localModelEnabled: settings.localModelEnabled,
    provider: settings.provider,
    remoteEndpoint: settings.remoteEndpoint || preset.defaultEndpoint,
    remoteModel: settings.remoteModel || preset.defaultModel,
    hasApiKey: Boolean(settings.remoteApiKey && settings.remoteApiKey.trim().length > 0),
    maskedApiKey: maskApiKey(settings.remoteApiKey),
    temperature: settings.temperature ?? 0.15,
    maxTokens: settings.maxTokens ?? 800,
    updatedAt: settings.updatedAt,
  };
}

/**
 * Persists updated AI settings to the Kubernetes ConfigMap vcop-ai-config in vcop-system.
 */
export async function saveAISettings(
  partial: Partial<AISettingsConfig>
): Promise<AISettingsConfig> {
  const current = await getAISettings();

  // If apiKey is explicitly provided, update it. If omitted or undefined, retain the existing key.
  let effectiveApiKey = current.remoteApiKey;
  if (partial.remoteApiKey !== undefined) {
    effectiveApiKey = partial.remoteApiKey.trim();
  }

  const updated: AISettingsConfig = {
    ...current,
    ...partial,
    localModelEnabled:
      partial.localModelEnabled !== undefined ? partial.localModelEnabled : current.localModelEnabled,
    provider: partial.provider || current.provider,
    remoteEndpoint:
      partial.remoteEndpoint !== undefined ? partial.remoteEndpoint.trim() : current.remoteEndpoint,
    remoteModel:
      partial.remoteModel !== undefined ? partial.remoteModel.trim() : current.remoteModel,
    remoteApiKey: effectiveApiKey,
    temperature: partial.temperature ?? current.temperature ?? 0.15,
    maxTokens: partial.maxTokens ?? current.maxTokens ?? 800,
    updatedAt: new Date().toISOString(),
  };

  const cmData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: AI_CONFIGMAP_NAME,
      namespace: AI_CONFIG_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': AI_CONFIGMAP_NAME,
        'app.kubernetes.io/part-of': 'vcop',
      },
    },
    data: {
      'ai-settings.json': JSON.stringify(updated, null, 2),
    },
  };

  const checkRes = await k8sRequest<any>(
    `/api/v1/namespaces/${AI_CONFIG_NAMESPACE}/configmaps/${AI_CONFIGMAP_NAME}`
  );

  if (checkRes.statusCode === 200) {
    await k8sRequest(
      `/api/v1/namespaces/${AI_CONFIG_NAMESPACE}/configmaps/${AI_CONFIGMAP_NAME}`,
      'PUT',
      cmData
    );
  } else {
    await k8sRequest(
      `/api/v1/namespaces/${AI_CONFIG_NAMESPACE}/configmaps`,
      'POST',
      cmData
    );
  }

  configCache = updated;
  lastFetchTime = Date.now();
  return updated;
}

/**
 * Tests connection to a remote model provider using the specified parameters.
 */
export async function testRemoteAIConnection(params: {
  provider: AIProviderType;
  endpoint?: string;
  model?: string;
  apiKey?: string;
}): Promise<AIConnectionTestResult> {
  const current = await getAISettings();
  const provider = params.provider || current.provider;
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.local;

  const endpoint = (params.endpoint || current.remoteEndpoint || preset.defaultEndpoint).trim();
  const model = (params.model || current.remoteModel || preset.defaultModel).trim();
  const apiKey = (params.apiKey !== undefined && params.apiKey !== ''
    ? params.apiKey
    : current.remoteApiKey || '').trim();

  if (provider === 'local') {
    // Test local service health
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${endpoint}/v1/models`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (res.ok) {
        return {
          ok: true,
          latencyMs,
          model: 'Gemma 3 1B IT (Q4_K_M)',
          message: `Successfully connected to local inference service (${latencyMs}ms)`,
        };
      }
      return {
        ok: false,
        latencyMs,
        message: `Local inference service returned HTTP ${res.status}: ${res.statusText}`,
        error: `HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        ok: false,
        message: `Could not reach local inference service at ${endpoint}: ${err.message}`,
        error: err.message,
      };
    }
  }

  // Remote providers require an API key (except optionally custom)
  if (preset.requiresKey && !apiKey) {
    return {
      ok: false,
      message: `API key is required for ${preset.name}`,
      error: 'Missing API Key',
    };
  }

  const start = Date.now();

  if (provider === 'anthropic') {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);
      const targetUrl = endpoint.endsWith('/messages')
        ? endpoint
        : `${endpoint.replace(/\/+$/, '')}/messages`;

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Ping' }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (res.ok) {
        return {
          ok: true,
          latencyMs,
          model,
          message: `Successfully authenticated and connected to Anthropic ${model} (${latencyMs}ms)`,
        };
      }

      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        latencyMs,
        message: `Anthropic API returned HTTP ${res.status}: ${errText.slice(0, 160)}`,
        error: `HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        ok: false,
        message: `Anthropic connection test failed: ${err.message}`,
        error: err.message,
      };
    }
  }

  // Standard OpenAI-Compatible Endpoints (OpenAI, Gemini, Groq, OpenRouter, Custom)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    let chatUrl = endpoint.replace(/\/+$/, '');
    if (!chatUrl.endsWith('/chat/completions')) {
      chatUrl = `${chatUrl}/chat/completions`;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return {
        ok: true,
        latencyMs,
        model,
        message: `Successfully authenticated and connected to ${preset.name} [${model}] (${latencyMs}ms)`,
      };
    }

    const errText = await res.text().catch(() => '');
    return {
      ok: false,
      latencyMs,
      message: `${preset.name} returned HTTP ${res.status}: ${errText.slice(0, 160)}`,
      error: `HTTP ${res.status}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `${preset.name} connection test failed: ${err.message}`,
      error: err.message,
    };
  }
}
