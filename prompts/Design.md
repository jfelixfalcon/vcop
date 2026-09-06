# Project Master Prompt: Cloud-Native vCluster Operator & Operations Center (vCOp)

### Objective & Role

You are a Principal DevSecOps and Cloud-Native Systems Architect specializing in Kubernetes operators, GitOps pipelines, enterprise multi-tenancy, and internal developer platforms (IDPs). Your task is to design, scaffold, and implement an enterprise-grade Virtual Cluster Management Platform called **vCluster Center of Operations (vCOp)**.

The platform consists of two tightly synchronized sub-systems backed by durable telemetry persistence:

1. **vCluster Kubernetes Operator**: A Go-based operator (built with Kubebuilder / controller-runtime) managing the complete declarative lifecycle of tenant virtual clusters using **vCluster OSS v0.36**, simplified topology tiers (`normal` and `ha`), enterprise OIDC governance, custom private PKI / CA trust, and guest RBAC synchronization.
2. **Operations Center UI**: An ultra-responsive, cybernetic web dashboard built with **Astro (SSR + Interactive React Islands)** that completely abstracts Kubernetes complexity for developers while delivering full day-2 observability (CPU/Memory performance curves, pod metrics, workloads, app store, quotas) with zero external Grafana dependency.

---

## 1. Core Architectural Requirements

### 1.1 Virtual Cluster Topology & Engine (vCluster OSS v0.36)

Each virtual cluster provisioned by the operator forms an isolated tenant control plane:

* **vCluster Engine:** `loft-sh/vcluster` OSS version `0.36.x` adhering to the unified `vcluster.yaml` schema.
* **Simplified Topology Tiers:**
  * **Normal Tier:** Streamlined single-replica footprint (1 control plane, 1 backing store, 1 CoreDNS). Ideal for dev/test sandboxes, QA previews, and lightweight microservices.
  * **High-Availability (HA) Tier:** Fully redundant 3-replica control plane, 3-replica backing store with quorum verification, and 3-replica CoreDNS. Ideal for production and mission-critical tenants.
* **Networking & Workload Syncer:** The vcluster syncer replicates guest pods, services, and ingresses into dedicated host namespaces while maintaining strict tenant network boundaries.

### 1.2 Enterprise Security, Private PKI & Custom CA Trust

In enterprise and internal on-prem environments, corporate endpoints (Keycloak, Dex, Gitlab, internal registries) frequently rely on private or self-signed Root Certificate Authorities:

* **Custom CA Root Injection:** Ability to inject corporate CA bundles (PEM certificates or Kubernetes TLS/CA Secrets) into the virtual cluster syncer and control plane pods (`--kube-ca` / `SSL_CERT_DIR`), enabling full TLS trust for internal endpoints.
* **Modern OIDC Authentication & PKCE:**
  * Support for OpenID Connect authentication with `--oidc-pkce-method=auto` (deprecating legacy boolean flags).
  * Automated tenant RBAC reconciliation: Synchronizes host-defined allowed groups/emails into in-cluster `ClusterRoleBinding` and `RoleBinding` objects inside the virtual cluster.
  * **Hierarchical OIDC Inheritance:** Multi-tier parameter resolution:
    1. **Global Default:** Organization-wide IdP parameters.
    2. **Cluster Group:** Team or environment-specific IdP settings (e.g. `data-engineering`, `dev-team`).
    3. **Cluster Custom:** Per-cluster specific client credentials and scope overrides.

### 1.3 Built-in Observability & Durable Metrics Storage (No Grafana Required)

Users must be able to inspect live and historical container metrics (CPU millicores, Memory working set, restarts, health status) directly inside vCOp:

* **Dedicated PostgreSQL Backing Store:** Deployed in `vcop-system` with a `PersistentVolumeClaim` (5Gi+ on standard StorageClass) to store time-series telemetry samples (`pod_metrics_samples`).
* **Continuous Background Telemetry Daemon:** Automated scraper polling virtual clusters every 30 seconds via `/apis/metrics.k8s.io/v1beta1/pods` and `/api/v1/pods`.
* **Historical Continuity Across Pod Rollouts:**
  * **The Problem:** Deployments and ReplicaSets generate random pod hashes upon updates (e.g., `nginx-7584b6f84c-xyz` replacing `nginx-8557b8b6df-abc`). Traditional pod-name indexing breaks history whenever a deployment rolls out.
  * **The Solution:** Index and aggregate metrics by `(vcluster, namespace, workload_kind, workload_name)` (e.g., `Deployment: nginx-test`). Historical curves remain continuous, smooth, and uninterrupted across rolling restarts and scaling events.
* **Interactive SVG Visualizations:** Smooth Bézier curve area charts with gradient fills, horizontal threshold gridlines, interactive hover crosshair scrubbing, and 5 selectable time horizons (`15m`, `1h`, `6h`, `24h`, `7d`).

---

## 2. Kubernetes Operator Specification

### 2.1 Technology Stack

* **Language:** Go 1.22+
* **Framework:** Controller-Runtime / Kubebuilder v4
* **Target vCluster Version:** `0.36.x`
* **API Group / Version:** `vops.gitops.io/v1alpha1`
* **Kind:** `VirtualCluster`

### 2.2 Custom Resource Definition (`VirtualCluster`)

```yaml
apiVersion: vops.gitops.io/v1alpha1
kind: VirtualCluster
metadata:
  name: vc-dev
  namespace: vc-dev
  annotations:
    vops.gitops.io/cluster-groups: "engineering,sandbox"
    vops.gitops.io/owner: "dev-team@company.com"
spec:
  clusterName: vc-dev
  vclusterVersion: "0.36.1"
  kubernetesVersion: "v1.31.0"
  topology: "normal" # enum: normal | ha
  components:
    coreDNS:
      enabled: true
    metricsServer:
      enabled: true
  security:
    customCaSecret: "corp-root-ca"
    oidc:
      enabled: true
      issuerUrl: "https://auth.company.com/realms/corp"
      clientId: "vc-dev-client"
      usernameClaim: "email"
      groupsClaim: "groups"
      pkceMethod: "auto"
  policies:
    resourceQuota:
      enabled: true
      requestsCPU: "4"
      limitsCPU: "8"
      requestsMemory: "8Gi"
      limitsMemory: "16Gi"
    limitRange:
      enabled: true
      defaultRequestCPU: "100m"
      defaultRequestMemory: "128Mi"
status:
  phase: Ready # Pending | Provisioning | Ready | Upgrading | Degraded | Sleeping
  conditions:
    - type: ControlPlaneReady
      status: "True"
    - type: MetricsServerReady
      status: "True"
  metrics:
    activeNodeCount: 1
    podCount: 6
    cpuUsage: "12m"
    memoryUsage: "185Mi"
```

### 2.3 Reconciliation Lifecycle & GitOps Guardrails

* **Deterministic Synchronization:** The operator reconciles desired state against the live cluster without race conditions or fighting with external GitOps engines (Argo CD or Flux).
* **Graceful Teardown & Finalizers:** Uses `vops.gitops.io/finalizer` to drain guest pods, remove host backing stores, and safely delete admin secrets.
* **Safe Rolling Upgrades:** Validates Kubernetes version compatibility jumps and sequences control-plane image updates with zero downtime.

---

## 3. Operations Center UI Specification (Astro + React Islands)

### 3.1 Design Philosophy & Aesthetic (2026 Minimalist Cybernetic)

* **Framework:** Astro in Standalone Server-Side Rendering (SSR) mode with React 19 interactive islands and Tailwind CSS.
* **Aesthetic:** Dark-mode first, glassmorphism surface panels (`bg-cyber-900/80`), subtle neon cyan/emerald/purple accents, high-contrast monospace indicators, and sub-100ms micro-interactions.
* **State & Polling Stability (Critical Rule):**
  * In components using background interval polling (e.g. 3-second telemetry refresh), **never place polled object references directly into modal `useEffect` dependency arrays**.
  * Use `[isOpen]` dependencies guarded by `if (isOpen && cluster)` to prevent user input keystrokes from resetting in real time while typing.
  * Pause background polling intervals while any modal is active (`activeModal !== null`).

### 3.2 User Navigation & Workspaces

The cluster management interface is organized into 6 focused operational tabs:

1. **Health & Telemetry:** Overall cluster status, control-plane conditions, phase badges, and quick resource sparklines.
2. **Pods & Metrics (Observability):**
   * Top KPI summary cards (CPU Utilization, Memory Working Set, Active Pods, Restarts).
   * Dual interactive SVG historical curves with crosshair scrubbing.
   * Multi-faceted filtering by Namespace, Workload Kind (`Deployment`, `StatefulSet`, `DaemonSet`, `Job`, `Pod`), and Health Status.
   * Grouped Workload View (expanding into underlying pod instances) and Flat Pod Table View.
   * Deep-dive Container Inspector modal (CPU/RAM quotas, container images, conditions, restart counts).
3. **Quotas & Policies:** Dual-scope ResourceQuota and LimitRange policy editor with instant presets (`Small`, `Medium`, `Large`).
4. **Access & RBAC:** Multi-tenant ownership, allowed group bindings, and guest cluster role mappings.
5. **Applications (App Store):** Curated catalog of cloud-native add-ons (Ingress controllers, Cert-Manager, Prometheus, Databases) deployed with 1 click via Helm or raw manifests.
6. **Effective vcluster.yaml:** Read-only inspection of the fully compiled, reconciled configuration.

---

## 4. Prompt Engineering Lessons & Architecture Design Patterns (2026 Edition)

When crafting master prompts for complex agentic systems and cloud-native platforms, observe the following prompt engineering principles:

### 4.1 Specify Non-Happy-Path & Enterprise Constraints Early
* *Anti-Pattern:* "Add OIDC authentication."
* *Best Practice:* "Add OIDC authentication supporting private endpoints with self-signed CA root certificates, modern `--oidc-pkce-method=auto`, and multi-tier inheritance (Global -> Group -> Cluster)."

### 4.2 Decouple High-Frequency Polling from Interactive Form State
* *Anti-Pattern:* "Make the dashboard update every 3 seconds."
* *Best Practice:* "Implement a 3-second background polling timer for live telemetry, but ensure editing modals suspend polling and decouple their input state initialization from polled object reference changes to prevent keystroke resets."

### 4.3 Design for Workload Continuity, Not Ephemeral Pod Names
* *Anti-Pattern:* "Store pod CPU and memory in a database."
* *Best Practice:* "Store pod metrics indexed by owner workload (`Deployment`, `StatefulSet`) so historical performance curves remain unbroken when pods cycle names during rolling deployments."

### 4.4 Separate Browser-Safe Code from Server-Only Subsystems
* *Anti-Pattern:* Importing utility functions from modules that contain Node.js built-ins (`fs`, `child_process`, `pg`).
* *Best Practice:* Isolate client-safe formatting and mathematical algorithms in dedicated files (`metrics-utils.ts`), keeping database pools and cluster executors in server-only modules (`metrics-db.ts`, `metrics-collector.ts`).

---

## 5. Directory Structure & File Map

```
/
├── Makefile                        # Top-level build and orchestration targets
├── README.md                       # Comprehensive platform documentation
├── apps/
│   ├── vc-operator/                # Go Kubernetes Operator (controller-runtime)
│   │   ├── api/v1alpha1/           # VirtualCluster CRD Go types
│   │   ├── controllers/            # Reconcilers (etcd, syncer, addons, metrics)
│   │   └── main.go                 # Operator entrypoint
│   └── ui/                         # Astro + React Operations Center
│       ├── Dockerfile              # Multi-stage production container build
│       ├── src/
│       │   ├── components/         # React Islands (ClusterDetail, WorkloadMetricsView, Modals)
│       │   ├── lib/                # Backend services (k8s-client, metrics-collector, metrics-db)
│       │   └── pages/              # Astro pages & API endpoints (/api/vclusters/*)
├── charts/
│   └── vcop/                       # Official Helm v3 Packaging
│       ├── Chart.yaml              # Chart metadata (v1.0.0)
│       ├── values.yaml             # Configurable values (operator, UI, metricsDb)
│       └── templates/              # Kubernetes templates (operator, ui, metrics-db)
├── deploy/                         # Standalone raw manifests
│   ├── crds/                       # CustomResourceDefinitions
│   ├── metrics-db.yaml             # PostgreSQL deployment + 5Gi PVC
│   ├── operator.yaml               # Operator deployment
│   └── ui.yaml                     # UI deployment + service
└── prompts/
    └── Design.md                   # This Master Design Document
```
