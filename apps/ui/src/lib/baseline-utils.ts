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
