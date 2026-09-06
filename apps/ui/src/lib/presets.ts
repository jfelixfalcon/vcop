import type { PresetDetails } from './types';

export const PRESETS: PresetDetails[] = [
  {
    id: 'normal',
    name: 'Normal Tier',
    cpu: '2 vCPU',
    memory: '4 GB RAM',
    storage: '10 GB NVMe',
    ha: false,
    badge: 'Standard',
    description: '1x etcd, 1x vCluster control plane, 1x CoreDNS. Efficient resource footprint for development and standard workloads.',
  },
  {
    id: 'ha',
    name: 'High Availability Tier',
    cpu: '6 vCPU',
    memory: '12 GB RAM',
    storage: '25 GB NVMe',
    ha: true,
    badge: 'Production HA',
    description: '3x etcd quorum, 3x vCluster control plane, 3x CoreDNS. Full redundancy and zero single points of failure.',
  },
];
