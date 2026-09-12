#!/usr/bin/env bash
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_IP="172.18.255.200"

echo "=== 1. Checking / Installing MetalLB ==="
if ! kubectl get ns metallb-system &>/dev/null; then
    echo "Installing MetalLB v0.14.9..."
    kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.9/config/manifests/metallb-native.yaml
    kubectl wait --namespace metallb-system --for=condition=ready pod --selector=app=metallb --timeout=90s
fi
kubectl apply -f "${DEV_DIR}/01-metallb.yaml"

echo "=== 2. Checking / Installing Envoy Gateway ==="
if ! helm status eg -n envoy-gateway-system &>/dev/null; then
    echo "Installing Envoy Gateway via Helm..."
    helm install eg oci://docker.io/envoyproxy/gateway-helm --version v1.9.1 -n envoy-gateway-system --create-namespace
    kubectl wait --timeout=5m -n envoy-gateway-system deployment/envoy-gateway --for=condition=Available
fi

echo "=== 3. Applying Certificates & Root CA ==="
kubectl apply -f "${DEV_DIR}/02-certificates-and-ca.yaml"
kubectl wait --timeout=30s -n cert-manager certificate/local-dev-ca --for=condition=Ready
kubectl wait --timeout=30s -n envoy-gateway-system certificate/gateway-tls-cert --for=condition=Ready
kubectl wait --timeout=30s -n default certificate/keycloak-tls-cert --for=condition=Ready

echo "=== 4. Updating Local CA in ConfigMap for BackendTLSPolicy ==="
kubectl get secret local-dev-ca-keypair -n cert-manager -o jsonpath='{.data.tls\.crt}' | base64 -d > /tmp/local-dev-ca.crt
kubectl create configmap keycloak-ca-cert -n default --from-file=ca.crt=/tmp/local-dev-ca.crt --dry-run=client -o yaml | kubectl apply -f -

echo "=== 5. Trusting Root CA on Host OS ==="
if [ -d "/etc/ca-certificates/trust-source/anchors" ]; then
    sudo cp /tmp/local-dev-ca.crt /etc/ca-certificates/trust-source/anchors/local-dev-ca.crt
    sudo update-ca-trust
    echo "Host trust store updated."
fi
rm -f /tmp/local-dev-ca.crt

echo "=== 6. Applying PostgreSQL Persistent Storage ==="
kubectl apply -f "${DEV_DIR}/03-postgres-db.yaml"
kubectl rollout status deployment/postgres-db -n default

echo "=== 7. Applying Keycloak CR ==="
kubectl apply -f "${DEV_DIR}/04-keycloak.yaml"

echo "=== 8. Applying Gateway API, Listeners, and Routes ==="
kubectl apply -f "${DEV_DIR}/05-gateway-api.yaml"
kubectl wait --timeout=60s -n envoy-gateway-system gateway/eg --for=condition=Programmed

echo "=== 9. Updating CoreDNS for in-cluster resolution ==="
kubectl apply -f "${DEV_DIR}/06-coredns.yaml"
kubectl rollout restart deployment/coredns -n kube-system
kubectl rollout status deployment/coredns -n kube-system

echo "=== 10. Updating /etc/hosts ==="
sudo sed -i '/vcop\.local/d' /etc/hosts
sudo sed -i '/keycloak\.local/d' /etc/hosts
echo "${GATEWAY_IP} vcop.local keycloak.local" | sudo tee -a /etc/hosts

echo "=== Deployment Complete ==="
echo "Access URLs:"
echo "  - VCOP UI:  https://vcop.local (HTTP automatically redirects to HTTPS)"
echo "  - Keycloak: https://keycloak.local/admin/ (HTTP automatically redirects to HTTPS)"
