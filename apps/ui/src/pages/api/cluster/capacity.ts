import type { APIRoute } from 'astro';
import { getHostClusterCapacity, getVClusterDemands } from '../../../lib/k8s-client';

export const GET: APIRoute = async () => {
  try {
    const capacity = await getHostClusterCapacity();
    return new Response(
      JSON.stringify({
        success: true,
        capacity,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to retrieve cluster capacity',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const capacity = await getHostClusterCapacity();

    const demands = getVClusterDemands({
      sizePreset: body.preset,
      customResources: body.customResources,
      policies: body.policies,
    });

    const errors: string[] = [];
    if (demands.reqCpuMillis > capacity.availableCpuMillis) {
      errors.push(
        `Requested CPU (${demands.reqCpuStr}) exceeds available cluster headroom (${capacity.availableCpuStr} remaining)`
      );
    }
    if (demands.reqMemBytes > capacity.availableMemoryBytes) {
      errors.push(
        `Requested Memory (${demands.reqMemStr}) exceeds available cluster headroom (${capacity.availableMemoryStr} remaining)`
      );
    }
    if (demands.reqStorageBytes > capacity.availableStorageBytes) {
      errors.push(
        `Requested Storage (${demands.reqStorageStr}) exceeds available cluster headroom (${capacity.availableStorageStr} remaining)`
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        fits: errors.length === 0,
        errors,
        demands,
        available: {
          cpuMillis: capacity.availableCpuMillis,
          cpuStr: capacity.availableCpuStr,
          memoryBytes: capacity.availableMemoryBytes,
          memoryStr: capacity.availableMemoryStr,
          storageBytes: capacity.availableStorageBytes,
          storageStr: capacity.availableStorageStr,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to validate capacity',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
