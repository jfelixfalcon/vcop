# vCluster Center of Operations (vCOp)

[![Go](https://img.shields.io/badge/Go-1.22%2B-blue.svg)](https://golang.org)
[![Astro](https://img.shields.io/badge/Astro-5.x%20SSR-orange.svg)](https://astro.build)
[![vCluster](https://img.shields.io/badge/vCluster%20OSS-v0.36-purple.svg)](https://vcluster.com)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-v1.31%2B-326CE5.svg)](https://kubernetes.io)

An enterprise-grade, cloud-native **Virtual Cluster Management Platform** and Internal Developer Platform (IDP) designed to manage multi-tenant virtual clusters using **vCluster OSS v0.36**, high-availability etcd, internal CoreDNS, and metrics-server.

---

## Architecture Overview

vCOp couples a high-performance Kubernetes Operator with an ultra-responsive Astro SSR Operations Center dashboard:

```
                  ┌────────────────────────────────────────────────────────┐
                  │               Operations Center UI (Astro SSR)         │
                  │   - Dark-mode Cybernetic Glassmorphism Aesthetic       │
                  │   - 3-Step 1-Click Provisioning Wizard                 │
                  │   - Live Fleet Health Sparklines & Telemetry           │
                  │   - Instant Kubeconfig Download & CLI Connect Snippets │
                  └───────────────────────────┬────────────────────────────┘
                                              │ REST / CRD Mutations
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                             Kubernetes Host Cluster (Control Plane)                      │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    vCOp Kubernetes Operator (Controller-Runtime)                   │  │
│  │   - Custom Resource: VirtualCluster (vops.gitops.io/v1alpha1)                      │  │
│  │   - Admission Webhook: Safe Minor Version Upgrades & Schema Validation             │  │
│  │   - Finalizer (vops.gitops.io/finalizer): Graceful Teardown & PVC Retention Cleanup│  │
│  └──────────────────────────────────────┬─────────────────────────────────────────────┘  │
│                                         │ Reconciles StatefulSets, Deployments, Secrets  │
│                                         ▼                                                │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                   Tenant Virtual Cluster (vCluster OSS v0.36)                      │  │
│  │                                                                                    │  │
│  │   ┌───────────────────────────────────┐    ┌───────────────────────────────────┐   │  │
│  │   │      High-Availability Backing    │    │      Virtual Kubernetes Syncer    │   │  │
│  │   │  - 3-Node Dedicated HA etcd       │◄───┤  - loft-sh/vcluster:0.36.x        │   │  │
│  │   │  - Peer Discovery (Port 2380)     │    │  - vcluster.yaml Unified Schema   │   │  │
│  │   │  - Client Listener (Port 2379)    │    │  - Workload Sync (Pods, Ingress)  │   │  │
│  │   │  - Persistent Volume Claims       │    │  - TLS Port 443 -> 8443           │   │  │
│  │   └───────────────────────────────────┘    └─────────────────┬─────────────────┘   │  │
│  │                                                              │                     │  │
│  │                                    ┌─────────────────────────┴─────────────────┐   │  │
│  │                                    │           Isolated Add-ons                │   │  │
│  │                                    │  - CoreDNS (Intra-cluster DNS)            │   │  │
│  │                                    │  - Metrics-Server (kubectl top & HPA)     │   │  │
│  │                                    └───────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Capabilities

### 1. vCluster OSS v0.36 Unified Engine
- Generates and enforces the unified `vcluster.yaml` schema introduced in v0.36.x.
- Zero external database dependencies: all state resides in native Kubernetes `CustomResources`, `ConfigMaps`, and `Secrets`.

### 2. High-Availability Backing Store (3-Node Quorum etcd)
- Automatically deploys a dedicated 3-replica etcd StatefulSet (`controlPlane.backingStore.etcd.deploy.statefulSet.highAvailability.replicas: 3`).
- Configures automated headless peer discovery and quorum health gating before control-plane readiness is asserted.

### 3. Isolated Core Add-ons
- **CoreDNS:** Enabled inside the virtual control plane for independent intra-vcluster service discovery without host DNS pollution.
- **Kubernetes Metrics Server:** Integrated inside the virtual cluster (`integrations.metricsServer.enabled: true`), allowing `kubectl top` and HPA controllers to function seamlessly within tenant boundaries.

### 4. Deterministic GitOps Interoperability
- Fully declarative Custom Resource Definitions (`VirtualCluster`).
- Compatible with Argo CD and Flux with zero controller drift fighting.

### 5. Safe Upgrade Sequencing & Admission Webhooks
- **vCluster Engine Upgrades:** Rolling update of syncer containers with pre-flight schema checks.
- **Kubernetes Upgrades:** Pre-flight etcd health check -> etcd snapshot checkpoint -> rolling API server upgrade -> add-on refresh.
- **Admission Webhooks & CEL:** Disallows downgrades, multi-minor version jumps (e.g. v1.29 to v1.31), and validates raw configuration blocks.

### 6. Operations Center UI (Astro SSR)
- **2026 Modern Minimalist Aesthetic:** Dark-mode first, glassmorphism surface panels, subtle cybernetic border glows, and high-contrast monospace accents.
- **1-Click Provisioning Wizard:** 3-step intuitive wizard abstracting all YAML and Kubernetes complexity for developers and QA testers.
- **Instant Kubeconfig & CLI Access:** Single-click download and live CLI connect command generator.
- **Telemetry Sparklines:** Real-time CPU and Memory utilization sparklines streamed directly from cluster telemetry.

---

## Directory Layout

```
vc-operator/
├── Makefile                            # Root build, test, and deploy orchestration
├── README.md                           # Master documentation
├── deploy/                             # Production Kubernetes manifests
│   ├── crds/
│   │   └── vops.gitops.io_virtualclusters.yaml   # CRD with OpenAPI v3 & CEL validation
│   ├── rbac/
│   │   ├── service_account.yaml        # ServiceAccounts for operator and UI
│   │   ├── role.yaml                   # ClusterRoles with scoped RBAC
│   │   └── role_binding.yaml           # ClusterRoleBindings
│   ├── presets/
│   │   ├── dev-sandbox.yaml            # 2 vCPU / 4GB RAM / 5GB single-node preset
│   │   ├── qa-staging.yaml             # 4 vCPU / 8GB RAM / 10GB 3-node HA preset
│   │   └── gpu-isolated.yaml           # 8 vCPU / 32GB RAM / 50GB NVMe GPU preset
│   ├── operator.yaml                   # Operator controller Deployment
│   ├── ui.yaml                         # Astro Operations Center Deployment & Service
│   └── samples/
│       ├── dev_cluster.yaml            # Sample sandbox VirtualCluster
│       └── prod_cluster.yaml           # Sample HA production VirtualCluster
├── apps/
│   ├── vc-operator/                    # Go Kubernetes Operator
│   │   ├── api/v1alpha1/               # Go CRD type definitions & deepcopy
│   │   ├── controllers/                # Master reconciler, etcd, syncer, upgrades
│   │   ├── pkg/vcluster/               # vCluster 0.36 vcluster.yaml generator & presets
│   │   ├── pkg/webhook/                # Admission webhook validation logic
│   │   ├── main.go                     # Operator entrypoint
│   │   ├── Makefile                    # Go build and test targets
│   │   └── Dockerfile                  # Multi-stage distroless build
│   └── ui/                             # Astro SSR Operations Center Dashboard
│       ├── src/
│       │   ├── components/             # React islands (Dashboard, Wizard, Modals)
│       │   ├── layouts/                # Astro base cybernetic layout
│       │   ├── pages/                  # SSR pages and REST API routes
│       │   └── lib/                    # K8s client & in-memory simulation engine
│       ├── astro.config.mjs            # Astro SSR Node configuration
│       ├── tailwind.config.mjs         # Cybernetic dark palette & glow utilities
│       ├── package.json                # Dependencies
│       └── Dockerfile                  # Production runner container
```

---

## Quickstart

### Prerequisites
- Go 1.22+
- Node.js 20+ & npm
- Kubernetes cluster (v1.28+) or local dev environment

### 1. Run Tests Across the Go Operator
```bash
make test
```
*Executes all unit tests, config generator verification, admission webhook tests, and controller reconciliation tests.*

### 2. Run the Operations Center UI Locally
```bash
make dev-ui
```
Open [http://localhost:4321](http://localhost:4321) in your browser.
*Note: In standalone development mode, vCOp includes a high-fidelity simulation engine that reproduces the operator's asynchronous reconciliation lifecycle, metric streaming, and provisioning transitions.*

### 3. Build Production Artifacts
```bash
make build
```
Compiles `apps/vc-operator/bin/manager` and creates the Astro SSR production bundle in `apps/ui/dist`.

### 4. Deploy to Kubernetes
```bash
# 1. Apply CRD definitions
make deploy-crds

# 2. Apply RBAC and ServiceAccounts
make deploy-rbac

# 3. Apply standard cluster presets
make deploy-presets

# 4. Deploy Operator and Operations Center UI
make deploy
```

---

## Custom Resource Definition (`VirtualCluster`)

Example minimal configuration:

```yaml
apiVersion: vops.gitops.io/v1alpha1
kind: VirtualCluster
metadata:
  name: billing-feature-auth
  namespace: default
spec:
  clusterName: billing-feature-auth
  vclusterVersion: "0.36.0"
  kubernetesVersion: "v1.31.0"
  sizePreset: medium
  highAvailability: true
  components:
    coreDNS:
      enabled: true
    metricsServer:
      enabled: true
  sync:
    pods: true
    services: true
    ingresses: true
  lifecycle:
    autoSleep: true
    ttlHours: 72
```

---

## License
Apache 2.0. Copyright 2026 vCOp Authors.
