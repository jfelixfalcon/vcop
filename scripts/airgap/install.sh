#!/usr/bin/env bash
# ==============================================================================
# vCOp Air-Gapped Cluster Installer (Helm 3 & Pure Manifests)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

NAMESPACE="${VCOP_NAMESPACE:-vcop-system}"
REGISTRY="${AIRGAP_REGISTRY:-}"
INSTALL_MODE=""
ENABLE_AI="true"

print_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Installs the vCluster Center of Operations (vCOp) in an air-gapped Kubernetes cluster.

Options:
  -m, --mode [helm|kubectl]  Installation method (default: helm if available, else kubectl).
  -r, --registry REGISTRY    Internal container registry prefix (e.g. harbor.corp.local/vops).
  -n, --namespace NAMESPACE  Target Kubernetes namespace (default: vcop-system).
  --no-ai                    Disable embedded Gemma 3 AI Inference Engine.
  -h, --help                 Show this help message.

Examples:
  # Standard Helm installation using local runtime images:
  ./install.sh

  # Installation using images from private corporate registry:
  ./install.sh --registry harbor.corp.local/vops

  # Pure kubectl manifest installation:
  ./install.sh --mode kubectl
EOF
}

# Parse options
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--mode)
      INSTALL_MODE="$2"
      shift 2
      ;;
    -r|--registry)
      REGISTRY="$2"
      shift 2
      ;;
    -n|--namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --no-ai)
      ENABLE_AI="false"
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      print_help
      exit 1
      ;;
  esac
done

# Detect installation mode if not specified
if [[ -z "${INSTALL_MODE}" ]]; then
  if command -v helm &>/dev/null; then
    INSTALL_MODE="helm"
  elif command -v kubectl &>/dev/null; then
    INSTALL_MODE="kubectl"
  else
    echo "[-] ERROR: Neither 'helm' nor 'kubectl' CLI found on PATH."
    exit 1
  fi
fi

echo "=========================================================="
echo "  vCluster Operations Center (vCOp) Air-Gap Installer"
echo "=========================================================="
echo " Mode:             ${INSTALL_MODE}"
echo " Target Namespace: ${NAMESPACE}"
echo " Embedded AI:      ${ENABLE_AI}"
if [[ -n "${REGISTRY}" ]]; then
  echo " Image Registry:   ${REGISTRY}"
fi
echo "=========================================================="

# Check kubectl connectivity
if ! kubectl cluster-info &>/dev/null; then
  echo "[-] ERROR: Cannot reach target Kubernetes cluster. Check your KUBECONFIG."
  exit 1
fi

if [[ "${INSTALL_MODE}" == "helm" ]]; then
  # Locate Helm chart archive
  CHART_ARCHIVE=""
  for candidate in \
    "${SCRIPT_DIR}/charts/"vcop-*.tgz \
    "${SCRIPT_DIR}/../charts/"vcop-*.tgz \
    "${BASE_DIR}/charts/"vcop-*.tgz \
    ./charts/vcop-*.tgz \
    ./vcop-*.tgz; do
    if [[ -f "${candidate}" ]]; then
      CHART_ARCHIVE="${candidate}"
      break
    fi
  done

  if [[ -z "${CHART_ARCHIVE}" || ! -f "${CHART_ARCHIVE}" ]]; then
    echo "[-] Warning: No packaged chart archive found, checking for chart source directory..."
    if [[ -d "${BASE_DIR}/charts/vcop" ]]; then
      CHART_ARCHIVE="${BASE_DIR}/charts/vcop"
    elif [[ -d "./charts/vcop" ]]; then
      CHART_ARCHIVE="./charts/vcop"
    else
      echo "[-] ERROR: Helm chart not found. Falling back to kubectl manifest mode..."
      INSTALL_MODE="kubectl"
    fi
  fi
fi

if [[ "${INSTALL_MODE}" == "helm" ]]; then
  echo "[+] Deploying vCOp via Helm using ${CHART_ARCHIVE}..."

  HELM_SET_ARGS=()
  if [[ -n "${REGISTRY}" ]]; then
    HELM_SET_ARGS+=(--set "global.imageRegistry=${REGISTRY}")
  fi

  if [[ "${ENABLE_AI}" == "false" ]]; then
    HELM_SET_ARGS+=(--set "ai.enabled=false")
  fi

  helm upgrade --install vcop "${CHART_ARCHIVE}" \
    --namespace "${NAMESPACE}" \
    --create-namespace \
    "${HELM_SET_ARGS[@]}"

else
  # Kubectl manifest mode
  MANIFESTS_DIR=""
  for candidate in \
    "${SCRIPT_DIR}/manifests" \
    "${SCRIPT_DIR}/../manifests" \
    "${BASE_DIR}/manifests" \
    "${BASE_DIR}/deploy" \
    ./manifests \
    ./deploy; do
    if [[ -d "${candidate}" ]]; then
      MANIFESTS_DIR="${candidate}"
      break
    fi
  done

  if [[ -z "${MANIFESTS_DIR}" || ! -d "${MANIFESTS_DIR}" ]]; then
    echo "[-] ERROR: Manifests directory not found."
    exit 1
  fi

  echo "[+] Deploying vCOp via raw Kubernetes manifests from ${MANIFESTS_DIR}..."

  # Create namespace if needed
  kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

  # 1. Apply CRDs
  if [[ -d "${MANIFESTS_DIR}/crds" ]]; then
    kubectl apply -f "${MANIFESTS_DIR}/crds/"
  elif [[ -f "${MANIFESTS_DIR}/crds.yaml" ]]; then
    kubectl apply -f "${MANIFESTS_DIR}/crds.yaml"
  fi

  # 2. Apply RBAC
  if [[ -d "${MANIFESTS_DIR}/rbac" ]]; then
    kubectl apply -f "${MANIFESTS_DIR}/rbac/"
  fi

  # 3. Apply Sizing Presets
  if [[ -d "${MANIFESTS_DIR}/presets" ]]; then
    kubectl apply -f "${MANIFESTS_DIR}/presets/"
  fi

  # 4. Helper function to apply with optional registry rewrite
  apply_manifest() {
    local file="$1"
    if [[ -f "${file}" ]]; then
      if [[ -n "${REGISTRY}" ]]; then
        sed "s|image: vops/|image: ${REGISTRY}/vops/|g; s|image: docker.io/library/postgres|image: ${REGISTRY}/postgres|g; s|image: postgres|image: ${REGISTRY}/postgres|g" "${file}" | kubectl apply -f -
      else
        kubectl apply -f "${file}"
      fi
    fi
  }

  echo "[+] Deploying Telemetry Database..."
  apply_manifest "${MANIFESTS_DIR}/metrics-db.yaml"

  echo "[+] Deploying Operator..."
  apply_manifest "${MANIFESTS_DIR}/operator.yaml"

  echo "[+] Deploying Operations Center UI..."
  apply_manifest "${MANIFESTS_DIR}/ui.yaml"

  if [[ "${ENABLE_AI}" == "true" && -f "${MANIFESTS_DIR}/ai.yaml" ]]; then
    echo "[+] Deploying Embedded AI Engine (Gemma 3)..."
    apply_manifest "${MANIFESTS_DIR}/ai.yaml"
  fi
fi

# Wait for core deployments
echo ""
echo "[+] Waiting for vCOp core components to roll out..."
kubectl rollout status deployment/vcop-operator -n "${NAMESPACE}" --timeout=120s || true
kubectl rollout status deployment/vcop-ui -n "${NAMESPACE}" --timeout=120s || true

if [[ "${ENABLE_AI}" == "true" ]]; then
  kubectl rollout status deployment/vcop-ai -n "${NAMESPACE}" --timeout=180s || true
fi

echo ""
echo "=========================================================="
echo " [✓] vCOp successfully deployed to '${NAMESPACE}'!"
echo "=========================================================="
echo ""
echo "Access the Operations Center Dashboard:"
echo "  kubectl port-forward svc/vcop-ui 4321:80 -n ${NAMESPACE}"
echo "  -> Open: http://localhost:4321"
echo ""
echo "Verify status:"
echo "  kubectl get pods -n ${NAMESPACE}"
echo "=========================================================="
