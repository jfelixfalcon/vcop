#!/usr/bin/env bash
# ==============================================================================
# vCOp Container Image Swap & Air-Gap Registry Relocation Engine
# ==============================================================================
# Rewrites FQDNs and namespaces/projects for all virtual cluster & platform images
# (e.g. Swapping harbor.com -> registry.com/library or relocating all images into
#  a single flat project in an enterprise private registry).
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SWAP_FROM=""
SWAP_TO=""
FLATTEN="true"
MANIFEST_FILE=""
OUTPUT_FILE=""
PULL_PUSH="false"
GENERATE_CONFIGMAP="false"
APPLY_TO_CLUSTER="false"
K8S_NAMESPACE="vcop-system"

print_help() {
  cat <<EOF
Usage: $(basename "$0") --to <target-registry/project> [OPTIONS]

Rewrites FQDN and repository paths for all vCluster & platform container images.
Supports flattening all images into a single project namespace (e.g. registry.com/library).

Options:
  -t, --to <target>            Target registry FQDN and project/namespace (REQUIRED)
                               (e.g., "registry.com/library" or "harbor.corp.internal/vclusters")
  -f, --from <source>          Specific source registry or prefix to match and swap
                               (e.g., "harbor.com" or "docker.io"). If omitted, all images
                               are relocated to the target registry.
      --flatten                Flatten repository path so images are placed directly under
                               target project (e.g., registry.com/library/vcluster-oss:0.36.0).
                               (Default: enabled)
      --no-flatten             Preserve nested repository paths.
  -m, --manifest <file>        Input image manifest file.
                               (Default: deploy/vcluster-images.txt or ./vcluster-images.txt)
  -o, --output <file>          Save rewritten image mapping list to file.
      --pull-push              Pull images from source, retag, and push to target registry
                               using local container engine (Docker, Podman, or Skopeo).
      --generate-configmap     Generate Kubernetes ConfigMap YAML (vcop-image-registry)
                               to stdout or file.
      --apply                  Apply the image registry configuration directly to Kubernetes
                               via kubectl in namespace '${K8S_NAMESPACE}'.
  -h, --help                   Show this help message.

Examples:
  # 1. Relocate all images to registry.com/library (flat structure):
  ./image-swap.sh --to registry.com/library

  # 2. Swap an existing Harbor FQDN to an air-gapped registry:
  ./image-swap.sh --from harbor.com --to registry.com/library

  # 3. Mirror all images directly into target registry with Docker/Podman:
  ./image-swap.sh --to registry.com/library --pull-push

  # 4. Generate & apply operator ConfigMap to update the active cluster:
  ./image-swap.sh --to registry.com/library --generate-configmap --apply
EOF
}

# Parse options
while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--to)
      SWAP_TO="$2"
      shift 2
      ;;
    -f|--from)
      SWAP_FROM="$2"
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
    -m|--manifest)
      MANIFEST_FILE="$2"
      shift 2
      ;;
    -o|--output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --pull-push)
      PULL_PUSH="true"
      shift
      ;;
    --generate-configmap)
      GENERATE_CONFIGMAP="true"
      shift
      ;;
    --apply)
      APPLY_TO_CLUSTER="true"
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "[-] ERROR: Unknown argument: $1"
      print_help
      exit 1
      ;;
  esac
done

if [[ -z "${SWAP_TO}" ]]; then
  echo "[-] ERROR: --to <target-registry> is required."
  echo "    Example: $(basename "$0") --to registry.com/library"
  exit 1
fi

# Clean trailing slashes
SWAP_TO="${SWAP_TO%/}"
SWAP_FROM="${SWAP_FROM%/}"

# Locate manifest file
if [[ -z "${MANIFEST_FILE}" ]]; then
  for candidate in \
    "${ROOT_DIR}/deploy/vcluster-images.txt" \
    "${SCRIPT_DIR}/../deploy/vcluster-images.txt" \
    "${SCRIPT_DIR}/vcluster-images.txt" \
    "${SCRIPT_DIR}/manifests/vcluster-images.txt" \
    "./vcluster-images.txt"; do
    if [[ -f "${candidate}" ]]; then
      MANIFEST_FILE="${candidate}"
      break
    fi
  done
fi

if [[ -z "${MANIFEST_FILE}" || ! -f "${MANIFEST_FILE}" ]]; then
  echo "[-] ERROR: Image manifest file not found!"
  echo "    Please specify with --manifest <path/to/vcluster-images.txt>"
  exit 1
fi

echo "=================================================================="
echo " vCOp Air-Gap Image Swap & Relocation Engine"
echo "=================================================================="
echo " Manifest:        ${MANIFEST_FILE}"
if [[ -n "${SWAP_FROM}" ]]; then
  echo " Swap Source:     ${SWAP_FROM}"
else
  echo " Swap Source:     * (All Canonical Registries)"
fi
echo " Target Registry: ${SWAP_TO}"
echo " Flatten Mode:    ${FLATTEN}"
echo "=================================================================="

# Function to rewrite a single image reference
# Args: <original-image> <target-registry> <swap-from> <flatten>
rewrite_image() {
  local orig="$1"
  local target="$2"
  local from="$3"
  local flatten="$4"

  # Strip tag or digest
  local ref="${orig}"
  local tag=""
  local digest=""

  if [[ "${ref}" == *"@"* ]]; then
    digest="@${ref#*@}"
    ref="${ref%%@*}"
  fi

  if [[ "${ref}" == *":"* ]]; then
    # Distinguish port from tag: check if colon is after the last slash
    local after_last_slash="${ref##*/}"
    if [[ "${after_last_slash}" == *":"* ]]; then
      tag=":${after_last_slash#*:}"
      ref="${ref%:${after_last_slash#*:}}"
    fi
  fi

  local domain=""
  local path=""
  local repo=""

  local first_part="${ref%%/*}"
  if [[ "${first_part}" == *"."* || "${first_part}" == *":"* || "${first_part}" == "localhost" ]]; then
    domain="${first_part}"
    ref="${ref#*/}"
  fi

  repo="${ref##*/}"
  if [[ "${ref}" == *"/"* ]]; then
    path="${ref%/*}"
  fi

  local tag_suffix="${tag}${digest}"

  # If explicit swapFrom provided
  if [[ -n "${from}" ]]; then
    local orig_full="${orig%%:*}"
    orig_full="${orig_full%%@*}"
    if [[ "${orig}" == "${from}"* || "${domain}" == "${from}" || "${domain}/${path}" == "${from}"* ]]; then
      if [[ "${flatten}" == "true" ]]; then
        echo "${target}/${repo}${tag_suffix}"
        return
      fi
      local trimmed="${orig#${from}}"
      trimmed="${trimmed#/}"
      echo "${target}/${trimmed}"
      return
    fi
    # If swapFrom doesn't match, return original
    echo "${orig}"
    return
  fi

  # Target relocation for any image
  if [[ "${flatten}" == "true" ]]; then
    echo "${target}/${repo}${tag_suffix}"
  else
    if [[ -n "${path}" ]]; then
      echo "${target}/${path}/${repo}${tag_suffix}"
    else
      echo "${target}/${repo}${tag_suffix}"
    fi
  fi
}

# Collect and rewrite images
ORIGINAL_IMAGES=()
REWRITTEN_IMAGES=()

while IFS= read -r line || [[ -n "${line}" ]]; do
  # Trim whitespace and ignore comments / blank lines
  line="$(echo "${line}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [[ -z "${line}" || "${line}" =~ ^# ]]; then
    continue
  fi

  new_img="$(rewrite_image "${line}" "${SWAP_TO}" "${SWAP_FROM}" "${FLATTEN}")"
  ORIGINAL_IMAGES+=("${line}")
  REWRITTEN_IMAGES+=("${new_img}")
done < "${MANIFEST_FILE}"

echo ""
printf "%-55s -> %-55s\n" "ORIGINAL SOURCE IMAGE" "REWRITTEN TARGET IMAGE"
printf "%-55s    %-55s\n" "-------------------------------------------------------" "-------------------------------------------------------"

MAPPING_OUTPUT=""
for i in "${!ORIGINAL_IMAGES[@]}"; do
  src="${ORIGINAL_IMAGES[$i]}"
  dst="${REWRITTEN_IMAGES[$i]}"
  printf "%-55s -> %-55s\n" "${src}" "${dst}"
  MAPPING_OUTPUT+="${src} -> ${dst}"$'\n'
done

# Save mapping if requested
if [[ -n "${OUTPUT_FILE}" ]]; then
  echo "${MAPPING_OUTPUT}" > "${OUTPUT_FILE}"
  echo ""
  echo "[✓] Saved image mapping list to ${OUTPUT_FILE}"
fi

# Generate ConfigMap YAML if requested
CONFIGMAP_YAML=""
if [[ "${GENERATE_CONFIGMAP}" == "true" || "${APPLY_TO_CLUSTER}" == "true" ]]; then
  TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  CONFIGMAP_YAML=$(cat <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: vcop-image-registry
  namespace: ${K8S_NAMESPACE}
  labels:
    app.kubernetes.io/name: vcop-image-registry
    app.kubernetes.io/part-of: vcop
data:
  image-registry.json: |
    {
      "targetRegistry": "${SWAP_TO}",
      "swapFrom": "${SWAP_FROM}",
      "swapTo": "${SWAP_TO}",
      "flatten": ${FLATTEN},
      "rules": [
        {
          "from": "${SWAP_FROM}",
          "to": "${SWAP_TO}"
        }
      ],
      "updatedAt": "${TIMESTAMP}"
    }
EOF
)
  if [[ "${GENERATE_CONFIGMAP}" == "true" ]]; then
    echo ""
    echo "=== Generated Kubernetes ConfigMap (vcop-image-registry) ==="
    echo "${CONFIGMAP_YAML}"
  fi
fi

# Apply ConfigMap to active Kubernetes cluster
if [[ "${APPLY_TO_CLUSTER}" == "true" ]]; then
  echo ""
  echo "[+] Applying ConfigMap to cluster (namespace: ${K8S_NAMESPACE})..."
  if command -v kubectl &>/dev/null; then
    echo "${CONFIGMAP_YAML}" | kubectl apply -f -
    echo "[✓] Applied vcop-image-registry ConfigMap successfully!"
  else
    echo "[-] ERROR: kubectl CLI not found in PATH. Cannot apply ConfigMap."
    exit 1
  fi
fi

# Optional: Pull, Tag, and Push
if [[ "${PULL_PUSH}" == "true" ]]; then
  echo ""
  echo "=== Pulling, Tagging, and Pushing Images ==="

  ENGINE=""
  if command -v skopeo &>/dev/null; then
    ENGINE="skopeo"
  elif command -v docker &>/dev/null; then
    ENGINE="docker"
  elif command -v podman &>/dev/null; then
    ENGINE="podman"
  else
    echo "[-] ERROR: No container tool found (skopeo, docker, podman required for --pull-push)."
    exit 1
  fi

  echo "[+] Using transfer engine: ${ENGINE}"

  for i in "${!ORIGINAL_IMAGES[@]}"; do
    src="${ORIGINAL_IMAGES[$i]}"
    dst="${REWRITTEN_IMAGES[$i]}"

    echo ""
    echo "Transferring: [${src}] -> [${dst}]"
    if [[ "${ENGINE}" == "skopeo" ]]; then
      skopeo copy "docker://${src}" "docker://${dst}"
    else
      "${ENGINE}" pull "${src}"
      "${ENGINE}" tag "${src}" "${dst}"
      "${ENGINE}" push "${dst}"
    fi
  done

  echo ""
  echo "[✓] All images successfully transferred to ${SWAP_TO}!"
fi

echo ""
echo "=================================================================="
echo " Summary:"
echo " Total images processed: ${#ORIGINAL_IMAGES[@]}"
echo " Target registry prefix: ${SWAP_TO}"
echo " All containers available inside: ${SWAP_TO}"
echo "=================================================================="
