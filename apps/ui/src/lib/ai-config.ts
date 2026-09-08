import { k8sRequest } from './k8s-client';
import type {
  AISettingsConfig,
  AISettingsPublic,
  AIConnectionTestResult,
} from './types';

export const AI_CONFIGMAP_NAME = 'vcop-ai-config';
export const AI_CONFIG_NAMESPACE = 'vcop-system';

export const DEFAULT_LOCAL_ENDPOINT =
  process.env.AI_SERVICE_URL ||
  (process.env.KUBERNETES_SERVICE_HOST
    ? 'http://vcop-ai.vcop-system.svc:8080'
    : 'http://127.0.0.1:8088');

export const DEFAULT_LOCAL_MODEL = 'Gemma 3 1B IT (Q4_K_M)';
export const DEFAULT_REMOTE_ENDPOINT = 'https://api.openai.com/v1';
export const DEFAULT_REMOTE_MODEL = 'gpt-4o-mini';

export const DEFAULT_AI_SETTINGS: AISettingsConfig = {
  localModelEnabled: process.env.AI_LOCAL_ENABLED !== 'false',
  provider: 'custom',
  remoteEndpoint: process.env.AI_REMOTE_ENDPOINT || DEFAULT_REMOTE_ENDPOINT,
  remoteModel: process.env.AI_REMOTE_MODEL || DEFAULT_REMOTE_MODEL,
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
 * Retrieves AI settings from the Kubernetes ConfigMap or default environment variables.
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
        remoteEndpoint: parsed.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT,
        remoteModel: parsed.remoteModel || DEFAULT_REMOTE_MODEL,
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

  return {
    localModelEnabled: settings.localModelEnabled,
    provider: 'custom',
    remoteEndpoint: settings.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT,
    remoteModel: settings.remoteModel || DEFAULT_REMOTE_MODEL,
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

  // If apiKey is explicitly provided, update it. If omitted, retain existing key.
  let effectiveApiKey = current.remoteApiKey;
  if (partial.remoteApiKey !== undefined) {
    effectiveApiKey = partial.remoteApiKey.trim();
  }

  const updated: AISettingsConfig = {
    ...current,
    ...partial,
    localModelEnabled:
      partial.localModelEnabled !== undefined ? partial.localModelEnabled : current.localModelEnabled,
    provider: 'custom',
    remoteEndpoint:
      partial.remoteEndpoint !== undefined
        ? partial.remoteEndpoint.trim()
        : current.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT,
    remoteModel:
      partial.remoteModel !== undefined
        ? partial.remoteModel.trim()
        : current.remoteModel || DEFAULT_REMOTE_MODEL,
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
 * Tests connection to local inference or a remote OpenAI-compatible API endpoint.
 */
export async function testRemoteAIConnection(params: {
  endpoint?: string;
  model?: string;
  apiKey?: string;
  testLocal?: boolean;
}): Promise<AIConnectionTestResult> {
  const current = await getAISettings();

  // Test local service if requested
  if (params.testLocal) {
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${DEFAULT_LOCAL_ENDPOINT}/v1/models`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (res.ok) {
        return {
          ok: true,
          latencyMs,
          model: DEFAULT_LOCAL_MODEL,
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
        message: `Could not reach local inference service at ${DEFAULT_LOCAL_ENDPOINT}: ${err.message}`,
        error: err.message,
      };
    }
  }

  // Test Remote OpenAI-Compatible API
  const endpoint = (params.endpoint || current.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT).trim();
  const model = (params.model || current.remoteModel || DEFAULT_REMOTE_MODEL).trim();
  const apiKey = (params.apiKey !== undefined && params.apiKey !== ''
    ? params.apiKey
    : current.remoteApiKey || '').trim();

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

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
        message: `Successfully connected to OpenAI-compatible API [${model}] (${latencyMs}ms)`,
      };
    }

    const errText = await res.text().catch(() => '');
    return {
      ok: false,
      latencyMs,
      message: `OpenAI API returned HTTP ${res.status}: ${errText.slice(0, 160)}`,
      error: `HTTP ${res.status}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `Connection test failed: ${err.message}`,
      error: err.message,
    };
  }
}
