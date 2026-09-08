#!/usr/bin/env bash
# ==============================================================================
# vCOp Air-Gapped Image Loader & Private Registry Relocation Engine
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

REGISTRY="${AIRGAP_REGISTRY:-}"
IMAGES_ARCHIVE="${1:-}"
FLATTEN="true"

print_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [IMAGES_ARCHIVE]

Loads vCOp container images into the local container runtime (Docker, Podman,
nerdctl, or containerd) in an air-gapped environment. Optionally retags and
pushes all images to an internal corporate registry.

Arguments:
  IMAGES_ARCHIVE           Path to the vCOp images tarball (.tar or .tar.gz).
                           If omitted, searches ./images/ automatically.

Options:
  -r, --registry REGISTRY  Internal registry prefix to retag and push images to
                           (e.g., registry.com/library or harbor.internal:5000/vops).
                           Can also be set via AIRGAP_REGISTRY environment variable.
      --flatten            Flatten image repositories into target project (Default: true).
      --no-flatten         Preserve multi-level subpaths when pushing.
  -h, --help               Show this help message.

Examples:
  # Load images directly into local Docker / containerd daemon:
  ./load-images.sh

  # Load and push to private enterprise registry project:
  ./load-images.sh --registry registry.com/library
EOF
}

# Parse options
while [[ $# -gt 0 ]]; do
  case "$1" in
    -r|--registry)
      REGISTRY="$2"
      shift 2
      ;;
    --flatten)
      FLATTEN="true"
      shift
      ;;
    --no-flatten)
      FLATTEN="false"
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      if [[ -z "${IMAGES_ARCHIVE}" ]]; then
        IMAGES_ARCHIVE="$1"
        shift
      else
        echo "Unknown argument: $1"
        print_help
        exit 1
      fi
      ;;
  esac
done

# Locate image archive if not specified
if [[ -z "${IMAGES_ARCHIVE}" ]]; then
  for candidate in \
    "${SCRIPT_DIR}/images/"*.tar* \
    "${SCRIPT_DIR}/../images/"*.tar* \
    "${BASE_DIR}/images/"*.tar* \
    ./images/*.tar* \
    ./*.tar*; do
    if [[ -f "${candidate}" ]]; then
      IMAGES_ARCHIVE="${candidate}"
      break
    fi
  done
fi

if [[ -z "${IMAGES_ARCHIVE}" || ! -f "${IMAGES_ARCHIVE}" ]]; then
  echo "[-] ERROR: Image archive not found!"
  echo "    Please specify the path: $(basename "$0") /path/to/vcop-airgap-images-*.tar.gz"
  exit 1
fi

echo "=== vCOp Air-Gap Image Relocation Engine ==="
echo " Archive: ${IMAGES_ARCHIVE}"
if [[ -n "${REGISTRY}" ]]; then
  echo " Target Private Registry: ${REGISTRY}"
fi
echo "============================================"

# Detect container runtime
RUNTIME=""
if command -v docker &>/dev/null; then
  RUNTIME="docker"
elif command -v podman &>/dev/null; then
  RUNTIME="podman"
elif command -v nerdctl &>/dev/null; then
  RUNTIME="nerdctl"
elif command -v ctr &>/dev/null; then
  RUNTIME="ctr"
else
  echo "[-] ERROR: No container engine found (checked docker, podman, nerdctl, ctr)."
  exit 1
fi

echo "[+] Detected container runtime: ${RUNTIME}"
echo "[+] Loading images from ${IMAGES_ARCHIVE}..."

LOADED_IMAGES=()

if [[ "${RUNTIME}" == "ctr" ]]; then
  # ctr containerd import
  if [[ "${IMAGES_ARCHIVE}" == *.gz ]]; then
    gzip -dc "${IMAGES_ARCHIVE}" | ctr -n k8s.io images import -
  else
    ctr -n k8s.io images import "${IMAGES_ARCHIVE}"
  fi
else
  # docker, podman, nerdctl
  LOAD_OUTPUT=$("${RUNTIME}" load -i "${IMAGES_ARCHIVE}")
  echo "${LOAD_OUTPUT}"
  # Extract image tags from output
  while IFS= read -r line; do
    if [[ "${line}" =~ (Loaded image:\ |Loaded image\(s\):\ )(.+) ]]; then
      LOADED_IMAGES+=("${BASH_REMATCH[2]}")
    elif [[ "${line}" =~ (sha256:[a-f0-9]+) ]]; then
      :
    fi
  done <<< "${LOAD_OUTPUT}"
fi

echo "[✓] Images successfully imported into ${RUNTIME}!"

# If no target registry specified, we're done
if [[ -z "${REGISTRY}" ]]; then
  echo ""
  echo "All container images are loaded into local runtime."
  echo "If deploying with Helm or manifests, you can now run ./install.sh"
  exit 0
fi

# Retag and push to specified private registry
echo ""
echo "=== Retagging and Pushing Images to ${REGISTRY} ==="
# Clean trailing slash from registry
REGISTRY="${REGISTRY%/}"

# Known vCOp and vCluster images
DEFAULT_IMAGES=(
  "ghcr.io/loft-sh/vcluster-oss"
  "ghcr.io/loft-sh/kubernetes"
  "registry.k8s.io/etcd"
  "registry.k8s.io/coredns/coredns"
  "registry.k8s.io/metrics-server/metrics-server"
  "docker.io/istio/pilot"
  "docker.io/istio/proxyv2"
  "vops/etcd-dr-runner"
  "vops/vc-operator"
  "vops/vc-operations-center"
  "vops/vc-ai"
  "postgres:16-alpine"
)

# If LOADED_IMAGES is empty (some docker versions output format differs), find local images
if [[ ${#LOADED_IMAGES[@]} -eq 0 ]]; then
  for img in "${DEFAULT_IMAGES[@]}"; do
    matched=$("${RUNTIME}" images --format "{{.Repository}}:{{.Tag}}" | grep -E "^${img}" || true)
    for m in ${matched}; do
      LOADED_IMAGES+=("${m}")
    done
  done
fi

for source_img in "${LOADED_IMAGES[@]}"; do
  # Determine destination name
  # Flatten mode strips leading domains/paths so image lands directly in target registry/project
  if [[ "${FLATTEN}" == "true" ]]; then
    # e.g., ghcr.io/loft-sh/vcluster-oss:0.36.0 -> vcluster-oss:0.36.0
    repo_tag="${source_img##*/}"
    target_img="${REGISTRY}/${repo_tag}"
  else
    # Preserve subpath without the domain
    clean_name="${source_img}"
    # Remove leading domain if present (e.g. ghcr.io/, registry.k8s.io/)
    if [[ "${clean_name}" =~ ^[^/]+\.[^/]+/ ]]; then
      clean_name="${clean_name#*/}"
    fi
    target_img="${REGISTRY}/${clean_name}"
  fi

  echo "  -> Tagging: ${source_img} -> ${target_img}"
  "${RUNTIME}" tag "${source_img}" "${target_img}"

  echo "  -> Pushing: ${target_img}..."
  "${RUNTIME}" push "${target_img}"
done

echo ""
echo "[✓] All images pushed successfully to ${REGISTRY}!"
echo ""
echo "Next step: Install vCOp specifying your private registry:"
echo "  ./install.sh --registry ${REGISTRY}"
