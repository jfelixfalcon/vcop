# Project Master Prompt: Cloud-Native vCluster Operator & Operations Center

### Objective & Role

You are a Principal DevSecOps and Cloud-Native Systems Architect specializing in Kubernetes operators, GitOps pipelines, and internal developer platforms (IDPs). Your task is to design, scaffold, and implement an end-to-end Virtual Cluster Management Platform called **vCluster Center of Operations (vCOp)**.

The platform consists of two synchronized sub-systems:

1. **vCluster Kubernetes Operator**: A Go-based operator (built with Kubebuilder / controller-runtime) managing the full lifecycle of tenant virtual clusters using **vCluster OSS v0.36**, high-availability etcd, CoreDNS, and native metrics-server.
2. **Operations Center UI**: An ultra-responsive web dashboard built with **Astro (SSR + Interactive Islands)** that abstracts all Kubernetes complexity for non-technical users while remaining strictly Kubernetes-native under the hood.

---

## 1. Core Architectural Requirements

### 1.1 Virtual Cluster Topology (vCluster OSS v0.36)

Each virtual cluster provisioned by the operator must form a production-grade, isolated core control plane with the following baseline specifications:

* **vCluster Engine:** `loft-sh/vcluster` OSS version `0.36.x` adhering to the unified `vcluster.yaml` schema.
* **High Availability Backing Store:** A dedicated 3-node HA etcd cluster (`controlPlane.backingStore.etcd.deploy.statefulSet.highAvailability.replicas: 3`) running with quorum verification, persistent storage claims, and automated peer discovery.
* **Core Internal Add-ons:**
* **CoreDNS:** Enabled and configured inside the virtual control plane for independent intra-vcluster service discovery.
* **Kubernetes Metrics:** Metrics-server integration enabled (`integrations.metricsServer.enabled: true`) inside the vcluster, allowing `kubectl top` and HPA controllers within the tenant cluster to function without host-level visibility.


* **Networking & Synchronization:** Syncer configured to replicate tenant workloads into dedicated host namespaces while maintaining strict boundary isolation (synced pods, services, and ingresses).

### 1.2 Native Kubernetes Primitives & GitOps Design

The entire system must operate purely on native Kubernetes storage and configuration constructs:

* **No External Databases:** All state must live within the host cluster as Custom Resources, `ConfigMaps`, and `Secrets`.
* **Kubeconfig Management:** Upon successful provisioning, the operator must extract the vcluster admin kubeconfig and store it in a designated host `Secret` (e.g., `<vcluster-name>-kubeconfig`) with standardized connection metadata.
* **Template System:** Common vcluster presets (e.g., `dev-sandbox`, `qa-staging`, `gpu-isolated`) must be stored as host `ConfigMaps` containing default `vcluster.yaml` blocks.
* **GitOps Interoperability:** All CRD mutations must be deterministic and declarative so that an external GitOps agent (Argo CD or Flux) can commit manifests or reconcile the CRDs directly without operator fighting or drift conflicts.

---

## 2. Kubernetes Operator Specification

### 2.1 Technology Stack

* **Language:** Go 1.22+
* **Framework:** Controller-Runtime / Kubebuilder v4
* **Target vCluster Version:** 0.36.x
* **API Group / Version:** `vops.gitops.io/v1alpha1`
* **Kind:** `VirtualCluster`

### 2.2 Custom Resource Definition (CRD)

Design the `VirtualCluster` CRD to provide both friendly high-level abstractions and full underlying passthrough to vCluster v0.36 configurations:

* **`spec.clusterName`** (string, required): Tenant-facing identifier.
* **`spec.vclusterVersion`** (string, default: `0.36.0`): Target vcluster engine version.
* **`spec.kubernetesVersion`** (string, default: `v1.31.0`): Virtual Kubernetes control plane version.
* **`spec.sizePreset`** (enum: `small`, `medium`, `large`, `custom`): High-level preset driving CPU, memory requests, and etcd storage tiers.
* **`spec.highAvailability`** (bool, default: `true`): Toggles 3-replica HA etcd and control-plane redundancy.
* **`spec.components`**:
* `coreDNS.enabled` (bool, default: `true`)
* `metricsServer.enabled` (bool, default: `true`)


* **`spec.helmValues` / `spec.rawConfig**` (`runtime.RawExtension`): Direct passthrough to the v0.36 `vcluster.yaml` configuration structure to ensure 100% feature parity with the official Helm chart/CLI values.
* **`status`**:
* `phase` (`Pending`, `Provisioning`, `Ready`, `Upgrading`, `Degraded`, `Terminating`)
* `conditions` (Standard K8s conditions: `EtcdReady`, `ControlPlaneReady`, `AddonsReady`, `KubeconfigGenerated`)
* `virtualK8sVersion` (Current detected API version)
* `vclusterVersion` (Current engine version)
* `endpoint` (Internal and external ingress access endpoints)
* `metrics` (Active node count, pod count, memory usage summary)



### 2.3 Reconciliation Logic & Best Practices

* **Idempotent Reconciliation:** Ensure reconciliation accurately compares desired state vs live state (Helm release state, StatefulSet rollout, Service availability).
* **Safe Upgrade Path:**
* **vCluster Engine Upgrades:** When `spec.vclusterVersion` changes, reconcile via rolling replacement of the syncer/control plane container images, ensuring etcd schema compatibility checks pass first.
* **Kubernetes Control Plane Upgrades:** When `spec.kubernetesVersion` is bumped, sequence the rollout: trigger etcd snapshot/backup -> upgrade API server & controller-manager -> monitor `Ready` status -> refresh in-cluster CoreDNS and add-on manifests.


* **Finalizers & Safe Teardown:** Implement a custom finalizer (`vops.gitops.io/finalizer`) to gracefully drain virtual pods, remove host resources, detach persistent volume claims, and delete associated Secrets/ConfigMaps.
* **Admission Webhooks:** Include a Validating Webhook to validate version jump safety (preventing unsupported downgrades or multi-minor version leaps) and schema-check the raw `vcluster.yaml` block.

---

## 3. Operations Center UI Specification (Astro)

### 3.1 Technology & Design Philosophy

* **Framework:** Astro (SSR Mode via Node or Deno adapter).
* **UI Components:** Interactive Islands using React or Svelte with Tailwind CSS and Lucide icons.
* **Aesthetic (2026 Modern Minimalist):** Dark-mode first, glassmorphism surface panels, subtle cybernetic border glows, high-contrast monospace typography for status/endpoints, and sub-100ms micro-interactions. Zero lag or page-reload flashes.
* **Target Persona:** Engineers and QA testers with **zero Kubernetes knowledge**. All raw YAML, pods, daemonsets, and CIDR blocks must be completely abstracted behind human terms.

### 3.2 User Experience & Flows

* **Dashboard / Cluster Fleet View:**
* Clean grid/table displaying all virtual clusters with traffic-light status badges (`Active`, `Syncing`, `Needs Upgrade`, `Error`).
* Instant filter by owner, status, or environment tag.
* Live health sparklines (CPU, Memory utilization streamed from host metrics).


* **One-Click Provisioning Wizard:**
* 3-step simple wizard: (1) Cluster Name & Purpose, (2) Size Tier (`Sandbox - 2 vCPU / 4GB`, `Standard - 4 vCPU / 8GB`, `Production HA - 8 vCPU / 16GB`), (3) Lifecycle Policies (Auto-sleep, TTL deletion).
* Checkbox: "Enable Monitoring & DNS" (pre-checked).
* Advanced toggle (hidden by default): raw version selector and custom YAML override.


* **Cluster Detail & Operations:**
* Single-click **"Download Kubeconfig"** button and an on-screen **"Copy Token / Connect via CLI"** snippet.
* Single-click **Upgrade Engine** and **Upgrade Kubernetes** dropdowns with clear pre-flight validation badges (e.g., `"v1.30 -> v1.31 (Compatible)"`).
* One-click **Delete** modal requiring typing the cluster name to prevent accidental teardown.



### 3.3 Backend API Integration

* Build Astro API endpoints (`/api/vclusters/*`) running on the server side.
* Authenticate against the Kubernetes cluster using native `in-cluster` ServiceAccount credentials or host `KUBECONFIG`.
* Map UI CRUD actions to Kubernetes Custom Resource operations (`POST`, `GET`, `PATCH`, `DELETE` on the `VirtualCluster` CRD).
* Expose a server-sent events (SSE) or polling endpoint fetching status updates and node/pod metric summaries directly from Kubernetes metrics APIs.

---

## 4. Output Deliverables Expected

Produce the implementation in structured, production-ready modules:

1. **CRD Definitions:** The complete YAML definition for `VirtualCluster` (`CustomResourceDefinition`) with OpenAPI v3 validation schema and CEL (Common Expression Language) validation rules.
2. **Operator Implementation:**
* Go project layout (`main.go`, `api/v1alpha1/`, `controllers/virtualcluster_controller.go`).
* Complete reconciliation loop handling HA etcd StatefulSets, vCluster Helm/manifest generation, CoreDNS, and Metrics Server provisioning.
* Version upgrade logic for vCluster and Kubernetes versions.


3. **vCluster 0.36 Configuration Templates:** The reference Go template/ConfigMap converting `spec` inputs into the validated `vcluster.yaml` format.
4. **Astro Operations Center UI:**
* Project directory layout and configuration (`astro.config.mjs`, `package.json`, Tailwind config).
* Key API route handlers (`/api/vclusters/index.ts`, `/api/vclusters/[name].ts`).
* Main dashboard and create-cluster UI components.


5. **Deployment Manifests & RBAC:** Complete RBAC roles, ServiceAccounts, and deployment manifests required to run the operator and UI inside the host cluster.

## 5. Project specific locations
* UI: apps/ui
* Operator: apps/vc-operator/