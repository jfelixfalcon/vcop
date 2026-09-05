import type { PresetDetails } from './types';

export const PRESETS: PresetDetails[] = [
  {
    id: 'small',
    name: 'Sandbox Tier',
    cpu: '2 vCPU',
    memory: '4 GB RAM',
    storage: '5 GB NVMe',
    ha: false,
    badge: 'Ephemeral & Fast',
    description: 'Perfect for fast PR testing, microservice unit validation, and local developer exploration with auto-sleep.',
  },
  {
    id: 'medium',
    name: 'Standard Tier',
    cpu: '4 vCPU',
    memory: '8 GB RAM',
    storage: '10 GB NVMe',
    ha: true,
    badge: 'Recommended',
    description: 'Balanced 3-node HA quorum setup tailored for QA integration, CI/CD runners, and shared staging fleets.',
  },
  {
    id: 'large',
    name: 'Production HA Tier',
    cpu: '8 vCPU',
    memory: '16 GB RAM',
    storage: '25 GB NVMe',
    ha: true,
    badge: 'High Performance',
    description: 'Full production isolation with dedicated 3-node etcd backing store, maximum throughput, and SLA guarantees.',
  },
  {
    id: 'custom',
    name: 'Custom Tier',
    cpu: 'Customizable',
    memory: 'Customizable',
    storage: 'Customizable',
    ha: true,
    badge: 'Advanced',
    description: 'Define custom compute, memory, and volume limits for specialized workloads like machine learning inference.',
  },
];
