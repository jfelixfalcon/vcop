/**
 * Pure client-safe baseline utilities.
 * Does not import any server or Node-only modules.
 */

/**
 * Computes the wildcard and primary FQDN for a given cluster name and base domain.
 * Automatically prepends *.[cluster-name].[baseDomain].
 */
export function computeClusterFqdn(clusterName: string, baseDomain: string): {
  wildcard: string;
  primary: string;
  hosts: string[];
} {
  const cleanName = (clusterName || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const cleanDomain = (baseDomain || 'test.example.com').trim().replace(/^\*\.?/, '').replace(/^\.+/, '');
  
  if (!cleanName) {
    return {
      wildcard: `*.${cleanDomain}`,
      primary: cleanDomain,
      hosts: [`*.${cleanDomain}`, cleanDomain],
    };
  }

  const wildcard = `*.${cleanName}.${cleanDomain}`;
  const primary = `${cleanName}.${cleanDomain}`;

  return {
    wildcard,
    primary,
    hosts: [wildcard, primary],
  };
}

/**
 * Parses user input selector string (e.g. "istio: ingressgateway", "app: custom-gw", or "ingressgateway")
 * into a Record<string, string>.
 */
export function parseSelector(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!str) return { istio: 'ingressgateway' };
  const pairs = str.split(/[,\n]/);
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    if (trimmed.includes(':')) {
      const [k, ...v] = trimmed.split(':');
      result[k.trim()] = v.join(':').trim();
    } else if (trimmed.includes('=')) {
      const [k, ...v] = trimmed.split('=');
      result[k.trim()] = v.join('=').trim();
    } else {
      result['istio'] = trimmed;
    }
  }
  return Object.keys(result).length > 0 ? result : { istio: 'ingressgateway' };
}

/**
 * Formats a selector Record<string, string> into a readable string like "istio: ingressgateway".
 */
export function formatSelector(sel?: Record<string, string>): string {
  if (!sel || Object.keys(sel).length === 0) return 'istio: ingressgateway';
  return Object.entries(sel)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}
