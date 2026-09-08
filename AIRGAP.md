# vCluster Operations Center (vCOp) - Air-Gapped Deployment Guide

This guide describes how to package, transfer, and deploy vCOp in strictly disconnected, air-gapped, and isolated sovereign enterprise environments without internet access.

---

## 1. Air-Gap Architecture & Offline Guarantees

vCOp is engineered to operate 100% autonomously without requiring external internet connectivity:

- **Self-Hosted Typography & Assets**: All typography (`Inter` and `JetBrains Mono` WOFF2) is packaged directly within the UI container image. External Google Fonts and CDN calls are completely eliminated.
- **Embedded Inline Icons**: All icons (`lucide-react`) are compiled into static client/server JavaScript chunks as pure inline SVG vector paths. No web font files, CSS icon fonts, or external icon registries are required.
- **Embedded Offline AI Copilot (Gemma 3)**: The AI inference engine (`vops/vc-ai`) bakes the quantized Gemma 3 1B IT model weights (`/models/gemma-3-1b-it-Q4_K_M.gguf`) at build time. It runs entirely inside your host cluster with zero egress to OpenAI, Google Vertex, or Hugging Face.
- **Zero External CDN Dependencies**: The entire Operations Center SSR application serves all stylesheets, scripts, and static resources directly from in-cluster containers.

---

## 2. Packaging the Air-Gap Distribution Bundle

On a machine with internet access (or your continuous integration runner):

### Quick Pack (Single Command)

```bash
# Build all container images, package Helm charts, bundle manifests, and export image archives
make airgap-pack
```

This generates `dist/vcop-airgap-bundle-v1.4.1.tar.gz` and its cryptographic `SHA256SUMS`.

### Bundle Structure

When extracted, the air-gap bundle contains:

```
vcop-airgap-bundle-v1.4.1/
├── AIRGAP.md                        # Air-gap operational reference
├── CHECKSUMS.txt                    # SHA256 validation manifest
├── charts/
│   ├── vcop-1.4.1.tgz               # Official vCOp Helm Chart
│   └── vcluster-istio-1.4.1.tgz     # Istio Gateway & Ingress Add-on Chart
├── manifests/
│   ├── crds/                        # Custom Resource Definitions (VirtualCluster)
│   ├── rbac/                        # ServiceAccounts, Roles, and Bindings
│   ├── presets/                     # Dev, QA, and GPU sizing presets
│   ├── metrics-db.yaml              # PostgreSQL Telemetry Database
│   ├── operator.yaml                # vCOp Kubernetes Operator
│   ├── ui.yaml                      # Operations Center Dashboard
│   ├── ai.yaml                      # Embedded Gemma 3 Inference Engine (Universal Hardware)
│   └── vcop-install-all-in-one.yaml # Concatenated all-in-one manifest
├── images/
│   └── vcop-airgap-images-v1.4.1.tar.gz # Saved container images:
│                                        #   - vops/vc-operator:v1.4.1
│                                        #   - vops/vc-operations-center:v1.4.1
│                                        #   - vops/etcd-dr-runner:v1.4.1
│                                        #   - vops/vc-ai:v1.4.1
│                                        #   - postgres:16-alpine
└── scripts/
    ├── load-images.sh               # Image loader and private registry pusher
    └── install.sh                   # Cluster installer (Helm & kubectl)
```

---

## 3. Transferring to the Air-Gapped Environment

1. Copy `vcop-airgap-bundle-v1.4.1.tar.gz` and `SHA256SUMS` to your transfer media (bastion jump host, USB drive, or secure optical media).
2. On your air-gapped target machine, verify file integrity:

```bash
sha256sum -c SHA256SUMS
```

3. Extract the archive:

```bash
tar -xzf vcop-airgap-bundle-v1.4.1.tar.gz
cd vcop-airgap-bundle-v1.4.1
```

---

## 4. Loading Container Images

### Option A: Direct Import into Local Cluster Runtime

If your cluster nodes run Docker, containerd, nerdctl, or Podman:

```bash
./scripts/load-images.sh
```

Supported container runtimes are automatically detected:
- **Docker**: `docker load -i ...`
- **Podman**: `podman load -i ...`
- **nerdctl**: `nerdctl -n k8s.io load -i ...`
- **containerd / crictl**: `ctr -n k8s.io images import ...`

### Option B: Push to an Internal Private Registry (Harbor, Nexus, ECR)

If your air-gapped cluster pulls from an internal image registry:

```bash
./scripts/load-images.sh --registry harbor.internal.corp/vops
```

This automatically retags all bundled images with the prefix `harbor.internal.corp/vops/` and executes a push.

---

## 5. Installing vCOp in the Air-Gapped Cluster

### Method 1: Automated Installer (Recommended)

Run the included `install.sh` script:

```bash
# When images were loaded directly into node runtimes:
./scripts/install.sh

# When using a private internal registry:
./scripts/install.sh --registry harbor.internal.corp/vops

# Lightweight installation without AI inference engine:
./scripts/install.sh --no-ai
```

### Method 2: Manual Helm Installation

```bash
helm upgrade --install vcop ./charts/vcop-1.4.1.tgz \
  --namespace vcop-system \
  --create-namespace \
  --set global.imageRegistry="harbor.internal.corp/vops"
```

### Method 3: Pure kubectl Manifests (No Helm Required)

```bash
# 1. Create namespace
kubectl create namespace vcop-system

# 2. Deploy CRDs & RBAC
kubectl apply -f ./manifests/crds/
kubectl apply -f ./manifests/rbac/
kubectl apply -f ./manifests/presets/

# 3. Deploy Components
kubectl apply -f ./manifests/metrics-db.yaml
kubectl apply -f ./manifests/operator.yaml
kubectl apply -f ./manifests/ui.yaml
kubectl apply -f ./manifests/ai.yaml
```

---

## 6. Verifying the Deployment

Inspect the running workloads in `vcop-system`:

```bash
kubectl get pods -n vcop-system -o wide
```

Expected output:
```
NAME                               READY   STATUS    RESTARTS   AGE
vcop-ai-5c558d754-xxxxx            1/1     Running   0          2m
vcop-metrics-db-5c958796f5-xxxxx   1/1     Running   0          2m
vcop-operator-89f6586f8-xxxxx      1/1     Running   0          2m
vcop-ui-67ffcf4ddb-xxxxx           1/1     Running   0          2m
```

Establish access to the Operations Center:

```bash
kubectl port-forward svc/vcop-ui 4321:80 -n vcop-system
```

Open `http://localhost:4321` in your browser. All fonts, icons, telemetry metrics, and AI Copilot capabilities will load cleanly without any network timeouts or external requests.
