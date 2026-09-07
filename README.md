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

### 3. Opinionated Core Add-ons & Ingress Entrypoint
- **CoreDNS:** Enabled inside the virtual control plane for independent intra-vcluster service discovery without host DNS pollution.
- **Kubernetes Metrics Server:** Integrated inside the virtual cluster (`integrations.metricsServer.enabled: true`), allowing `kubectl top` and HPA controllers to function seamlessly within tenant boundaries.
- **Istio Application Entrypoint (`charts/vcluster-istio`):**
  - High-performance ingress powered by in-cluster `istiod` and `istio-ingressgateway`.
  - Service mesh is optional and disabled by default (`meshEnabled: false`) to preserve lightweight isolation.
  - Automatic HTTP-to-HTTPS upgrade: Gateway terminates port 80 and redirects traffic cleanly to port 443 with TLS.
  - Pre-configured `main-entrypoint` VirtualService routing traffic to tenant services for cluster FQDN hosts.

### 4. Robust Cert-Manager TLS Integration (Fail-Closed)
- Operator interfaces with host-level cert-manager `Issuer` or `ClusterIssuer` resources.
- **Fail-Closed Guardrails:** If the specified issuer is missing from the host cluster, admission webhooks reject creation and operator reconciliation aborts deployment immediately with a `Degraded` phase, preventing zombie clusters.
- **Pre-Creation Warning:** Operations Center UI inspects host cert-manager APIs in real time, alerting users to missing issuers before cluster provisioning starts.
- **TLS Secret Mirroring:** Certificates requested on the host cluster are securely mirrored into the guest `istio-system` namespace.

### 5. Built-in Observability & Metrics (No Grafana Required)
- Dedicated PostgreSQL backing store in `vcop-system` holding time-series telemetry.
- Historical CPU millicores and Memory working-set aggregation indexed by workload owner (`Deployment`, `StatefulSet`) so curves remain uninterrupted across pod name rollouts.
- Interactive SVG Bézier charts with crosshair scrubbing across 5 time horizons (`15m`, `1h`, `6h`, `24h`, `7d`).

### 6. Deterministic GitOps Interoperability
- Fully declarative Custom Resource Definitions (`VirtualCluster`).
- Compatible with Argo CD and Flux with zero controller drift fighting.

### 7. Safe Upgrade Sequencing & Admission Webhooks
- **vCluster Engine Upgrades:** Rolling update of syncer containers with pre-flight schema checks.
- **Kubernetes Upgrades:** Pre-flight etcd health check -> etcd snapshot checkpoint -> rolling API server upgrade -> add-on refresh.
- **Admission Webhooks & CEL:** Disallows downgrades, multi-minor version jumps (e.g. v1.29 to v1.31), and validates raw configuration blocks.

### 8. Operations Center UI (Astro SSR)
- **2026 Modern Minimalist Aesthetic:** Dark-mode first, glassmorphism surface panels, subtle cybernetic border glows, and high-contrast monospace accents.
- **1-Click Provisioning Wizard:** 4-step intuitive wizard abstracting all YAML and Kubernetes complexity for developers and QA testers.
- **Ingress & Istio Configuration Modal:** Instant management of gateway hosts, TLS secrets, and issuer settings.
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
├── charts/
│   ├── vcop/                           # Official Helm v3 Packaging for Platform
│   └── vcluster-istio/                 # Dedicated Opinionated Istio & TLS Gateway Helm Chart
├── apps/
│   ├── vc-operator/                    # Go Kubernetes Operator
│   │   ├── api/v1alpha1/               # Go CRD type definitions & deepcopy
│   │   ├── controllers/                # Master reconciler, etcd, syncer, upgrades, istio
│   │   ├── pkg/vcluster/               # vCluster 0.36 vcluster.yaml generator & presets
│   │   ├── pkg/webhook/                # Admission webhook validation logic
│   │   ├── main.go                     # Operator entrypoint
│   │   ├── Makefile                    # Go build and test targets
│   │   └── Dockerfile                  # Multi-stage distroless build
│   └── ui/                             # Astro SSR Operations Center Dashboard
│       ├── src/
│       │   ├── components/             # React islands (Dashboard, Wizard, Modals, IstioModal)
│       │   ├── layouts/                # Astro base cybernetic layout
│       │   ├── pages/                  # SSR pages and REST API routes
│       │   └── lib/                    # K8s client, metrics-collector & metrics-db
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

Example configuration with Opinionated Core Stack (CoreDNS, Metrics-Server, Istio Entrypoint, Cert-Manager TLS):

```yaml
apiVersion: vops.gitops.io/v1alpha1
kind: VirtualCluster
metadata:
  name: billing-feature-auth
  namespace: default
  annotations:
    vops.gitops.io/custom-endpoint: "billing.apps.example.com"
spec:
  clusterName: billing-feature-auth
  vclusterVersion: "0.36.1"
  kubernetesVersion: "v1.31.0"
  topology: "normal" # normal (1 replica) | ha (3 replicas)
  components:
    coreDNS:
      enabled: true
    metricsServer:
      enabled: true
    istio:
      enabled: true
      certificateIssuer: "letsencrypt-staging"
      certificateIssuerKind: "ClusterIssuer" # ClusterIssuer | Issuer
      meshEnabled: false # optional service mesh
      hosts:
        - "billing.apps.example.com"
      gateway:
        createDefaultGateway: true
        httpPort: 80
        httpsPort: 443
        tlsSecretName: "billing-tls"
        httpsRedirect: true # automatic HTTP 80 -> HTTPS 443 upgrade
  sync:
    pods: true
    services: true
    ingresses: true
  lifecycle:
    autoSleep: true
    ttlHours: 72
```

---

## Authors & Contributors

- **Juan Felix-Falcon** ([@jfelixfalcon](https://github.com/jfelixfalcon)) — *Creator & Lead Maintainer*
- **vCOp Authors & Open Source Community**

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for contributor details. We welcome community pull requests, bug fixes, and feature proposals!

---

## License & Open Source Freedom

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

This project is truly open-source software licensed under the **[Apache License, Version 2.0](LICENSE)**.

### What does this mean?
- **Freedom to Use**: Anyone is free to deploy, run, and integrate vCOp commercially or privately with zero royalties.
- **Freedom to Modify**: You can adapt, refactor, fork, and enhance any part of the operator, UI, and Helm charts.
- **Freedom to Distribute**: You can redistribute original or modified versions of the codebase.
- **Patent Protection**: Includes an explicit patent grant protecting contributors and downstream users alike.

Copyright 2026 vCOp Authors (Juan Felix-Falcon). See [LICENSE](LICENSE) and [NOTICE](NOTICE) for full license terms.
