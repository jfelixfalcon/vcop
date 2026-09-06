export function parseCpuMillis(cpuStr?: string | number): number {
  if (cpuStr === undefined || cpuStr === null || cpuStr === '') return 0;
  if (typeof cpuStr === 'number') return Math.round(cpuStr * 1000);
  const str = String(cpuStr).trim();
  if (str.endsWith('n')) {
    return Math.round(parseFloat(str.slice(0, -1)) / 1_000_000);
  }
  if (str.endsWith('u')) {
    return Math.round(parseFloat(str.slice(0, -1)) / 1_000);
  }
  if (str.endsWith('m')) {
    return Math.round(parseFloat(str.slice(0, -1)));
  }
  const val = parseFloat(str);
  return isNaN(val) ? 0 : Math.round(val * 1000);
}

export function parseMemoryBytes(memStr?: string | number): number {
  if (memStr === undefined || memStr === null || memStr === '') return 0;
  if (typeof memStr === 'number') return memStr;
  const str = String(memStr).trim();
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 * 1024,
    Gi: 1024 * 1024 * 1024,
    Ti: 1024 * 1024 * 1024 * 1024,
    K: 1000,
    M: 1000 * 1000,
    G: 1000 * 1000 * 1000,
    T: 1000 * 1000 * 1000 * 1000,
  };
  for (const [unit, mult] of Object.entries(units)) {
    if (str.endsWith(unit)) {
      const num = parseFloat(str.slice(0, -unit.length));
      return isNaN(num) ? 0 : Math.round(num * mult);
    }
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

export function getClusterCapacity(spec: any): { cpuMillis: number; memoryBytes: number } {
  const quotaLimitsCpu = spec?.policies?.resourceQuota?.limitsCPU || spec?.policies?.resourceQuota?.requestsCPU;
  const quotaLimitsMem = spec?.policies?.resourceQuota?.limitsMemory || spec?.policies?.resourceQuota?.requestsMemory;

  let totalCpu = parseCpuMillis(quotaLimitsCpu);
  let totalMem = parseMemoryBytes(quotaLimitsMem);

  if (!totalCpu || !totalMem) {
    const preset = spec?.sizePreset || 'medium';
    switch (preset) {
      case 'small':
        totalCpu = totalCpu || 2000;
        totalMem = totalMem || 4 * 1024 * 1024 * 1024;
        break;
      case 'large':
        totalCpu = totalCpu || 8000;
        totalMem = totalMem || 16 * 1024 * 1024 * 1024;
        break;
      case 'custom':
        totalCpu = totalCpu || (spec?.customResources?.cpu ? parseCpuMillis(spec.customResources.cpu) : 4000);
        totalMem = totalMem || (spec?.customResources?.memory ? parseMemoryBytes(spec.customResources.memory) : 8 * 1024 * 1024 * 1024);
        break;
      case 'medium':
      default:
        totalCpu = totalCpu || 4000;
        totalMem = totalMem || 8 * 1024 * 1024 * 1024;
        break;
    }
  }
  return { cpuMillis: totalCpu, memoryBytes: totalMem };
}

export function formatMemoryBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}Ki`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}Mi`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}Gi`;
}

export function formatCpuMillis(millis: number): string {
  if (millis >= 1000) {
    return `${(millis / 1000).toFixed(2)} cores`;
  }
  return `${millis}m`;
}
