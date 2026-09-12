# Master Makefile for vCluster Center of Operations (vCOp)

VERSION ?= 1.5.0

OPERATOR_DIR = apps/vc-operator
UI_DIR = apps/ui
AI_DIR = apps/ai
DEPLOY_DIR = deploy
CHART_DIR = charts/vcop
ISTIO_CHART_DIR = charts/vcluster-istio
KIND_CLUSTER ?= kind

OPERATOR_IMG ?= vops/vc-operator:v$(VERSION)
UI_IMG ?= vops/vc-operations-center:v$(VERSION)
DR_RUNNER_IMG ?= vops/etcd-dr-runner:v$(VERSION)
AI_IMG ?= vops/vc-ai:v$(VERSION)
METRICS_DB_IMG ?= postgres:16-alpine
REGISTRY_IMG ?= registry:2.8.3

# Air-gap Packaging Variables
AIRGAP_DIST_DIR ?= dist/airgap
AIRGAP_BUNDLE_NAME ?= vcop-airgap-bundle-v$(VERSION)
AIRGAP_INCLUDE_AI ?= true

.PHONY: all
all: build test

##@ Development & Testing

.PHONY: test
test: test-operator ## Run all operator unit and reconciliation tests

.PHONY: test-operator
test-operator:
	@echo "=== Running Go Operator Tests ==="
	cd $(OPERATOR_DIR) && go test -v ./... -coverprofile cover.out

.PHONY: dev-ui
dev-ui: ## Run Astro Operations Center UI in local development mode
	@echo "=== Starting Astro Operations Center UI ==="
	cd $(UI_DIR) && npm run dev

.PHONY: dev-operator
dev-operator: ## Run the operator locally against host kubeconfig
	@echo "=== Starting vCOp Operator locally ==="
	cd $(OPERATOR_DIR) && go run ./main.go

##@ Building & Packaging

.PHONY: build
build: build-operator build-ui ## Build operator binary and Astro UI production bundle

.PHONY: build-operator
build-operator:
	@echo "=== Compiling Operator Binary ==="
	cd $(OPERATOR_DIR) && go build -o bin/manager main.go

.PHONY: build-ui
build-ui:
	@echo "=== Building Astro Operations Center UI ==="
	cd $(UI_DIR) && npm run build

.PHONY: docker-build
docker-build: docker-build-operator docker-build-ui docker-build-dr-runner docker-build-ai ## Build Docker images for Operator, UI, DR runner, and AI engine

.PHONY: docker-build-operator
docker-build-operator:
	@echo "=== Building Operator Docker Image: $(OPERATOR_IMG) ==="
	docker build -t $(OPERATOR_IMG) $(OPERATOR_DIR)

.PHONY: docker-build-ui
docker-build-ui:
	@echo "=== Building UI Docker Image: $(UI_IMG) ==="
	docker build -t $(UI_IMG) $(UI_DIR)

.PHONY: docker-build-dr-runner
docker-build-dr-runner:
	@echo "=== Building DR Runner Docker Image: $(DR_RUNNER_IMG) ==="
	docker build -t $(DR_RUNNER_IMG) $(OPERATOR_DIR)/dr-runner

.PHONY: docker-build-ai
docker-build-ai:
	@echo "=== Building AI Inference Engine Docker Image: $(AI_IMG) ==="
	docker build -t $(AI_IMG) $(AI_DIR)

##@ Kind (Local Cluster Image Caching)

.PHONY: kind-load
kind-load: ## Cache and load built Docker images directly into Kind cluster
	@echo "=== Loading container images into Kind cluster ($(KIND_CLUSTER)) ==="
	kind load docker-image $(OPERATOR_IMG) --name $(KIND_CLUSTER)
	kind load docker-image $(UI_IMG) --name $(KIND_CLUSTER)
	kind load docker-image $(DR_RUNNER_IMG) --name $(KIND_CLUSTER)
	kind load docker-image $(AI_IMG) --name $(KIND_CLUSTER)
	kind load docker-image $(METRICS_DB_IMG) --name $(KIND_CLUSTER)
	kind load docker-image $(REGISTRY_IMG) --name $(KIND_CLUSTER)
	@echo "=== Container images cached in Kind containerd! ==="

##@ Helm Chart Management

.PHONY: helm-lint
helm-lint: ## Lint the vCOp and Istio Helm charts
	@echo "=== Linting vCOp Helm Chart ==="
	helm lint $(CHART_DIR)
	@echo "=== Linting vCluster-Istio Helm Chart ==="
	helm lint $(ISTIO_CHART_DIR)

.PHONY: helm-install
helm-install: ## Install vCOp via Helm chart (into vcop-system namespace)
	@echo "=== Installing vCOp Helm Chart ==="
	helm install vcop $(CHART_DIR) --namespace vcop-system --create-namespace

.PHONY: helm-upgrade
helm-upgrade: ## Upgrade vCOp Helm release
	@echo "=== Upgrading vCOp Helm Chart ==="
	helm upgrade vcop $(CHART_DIR) --namespace vcop-system

.PHONY: helm-uninstall
helm-uninstall: ## Uninstall vCOp Helm release
	@echo "=== Uninstalling vCOp Helm Chart ==="
	helm uninstall vcop --namespace vcop-system

##@ Raw Manifest Deployment

.PHONY: deploy-crds
deploy-crds: ## Install CRDs into the target Kubernetes cluster
	kubectl apply -f $(DEPLOY_DIR)/crds/

.PHONY: deploy-rbac
deploy-rbac: ## Install ServiceAccounts and RBAC into the target Kubernetes cluster
	kubectl apply -f $(DEPLOY_DIR)/rbac/

.PHONY: deploy-presets
deploy-presets: ## Install standard ConfigMap templates and sizing presets
	kubectl apply -f $(DEPLOY_DIR)/presets/

.PHONY: deploy
deploy: deploy-crds deploy-rbac deploy-presets ## Deploy entire vCOp stack via raw manifests
	kubectl apply -f $(DEPLOY_DIR)/metrics-db.yaml
	kubectl apply -f $(DEPLOY_DIR)/operator.yaml
	kubectl apply -f $(DEPLOY_DIR)/ui.yaml
	kubectl apply -f $(DEPLOY_DIR)/ai.yaml
	kubectl apply -f $(DEPLOY_DIR)/registry.yaml

.PHONY: undeploy
undeploy: ## Remove vCOp operator and UI from cluster
	kubectl delete -f $(DEPLOY_DIR)/registry.yaml --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/ai.yaml --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/ui.yaml --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/operator.yaml --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/metrics-db.yaml --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/presets/ --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/rbac/ --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/crds/ --ignore-not-found

##@ Air-Gap Distribution Packaging

.PHONY: airgap-manifests
airgap-manifests: ## Stage air-gap manifests and all-in-one deployment YAML
	@echo "=== Staging Air-Gap Manifests ==="
	mkdir -p $(AIRGAP_DIST_DIR)/manifests/crds $(AIRGAP_DIST_DIR)/manifests/rbac $(AIRGAP_DIST_DIR)/manifests/presets
	cp -r $(DEPLOY_DIR)/crds/* $(AIRGAP_DIST_DIR)/manifests/crds/
	cp -r $(DEPLOY_DIR)/rbac/* $(AIRGAP_DIST_DIR)/manifests/rbac/
	cp -r $(DEPLOY_DIR)/presets/* $(AIRGAP_DIST_DIR)/manifests/presets/
	cp $(DEPLOY_DIR)/metrics-db.yaml $(AIRGAP_DIST_DIR)/manifests/
	cp $(DEPLOY_DIR)/operator.yaml $(AIRGAP_DIST_DIR)/manifests/
	cp $(DEPLOY_DIR)/ui.yaml $(AIRGAP_DIST_DIR)/manifests/
	cp $(DEPLOY_DIR)/ai.yaml $(AIRGAP_DIST_DIR)/manifests/
	cp $(DEPLOY_DIR)/vcluster-images.* $(AIRGAP_DIST_DIR)/manifests/
	@echo "Generating all-in-one offline installation manifest..."
	cat $(DEPLOY_DIR)/crds/vops.gitops.io_virtualclusters.yaml > $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/rbac/service_account.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/rbac/role.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/rbac/role_binding.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/presets/dev-sandbox.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/presets/qa-staging.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/presets/gpu-isolated.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/metrics-db.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/operator.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/ui.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/ai.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	@echo "---" >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml
	cat $(DEPLOY_DIR)/registry.yaml >> $(AIRGAP_DIST_DIR)/manifests/vcop-install-all-in-one.yaml

.PHONY: airgap-charts
airgap-charts: ## Package Helm charts for offline airgap installation
	@echo "=== Packaging Helm Charts ==="
	mkdir -p $(AIRGAP_DIST_DIR)/charts
	helm package $(CHART_DIR) --destination $(AIRGAP_DIST_DIR)/charts
	helm package $(ISTIO_CHART_DIR) --destination $(AIRGAP_DIST_DIR)/charts

.PHONY: airgap-scripts
airgap-scripts: ## Stage air-gap loader and installer scripts
	@echo "=== Staging Air-Gap Operational Scripts ==="
	mkdir -p $(AIRGAP_DIST_DIR)/scripts
	cp scripts/airgap/*.sh $(AIRGAP_DIST_DIR)/scripts/
	chmod +x $(AIRGAP_DIST_DIR)/scripts/*.sh
	cp AIRGAP.md $(AIRGAP_DIST_DIR)/AIRGAP.md

.PHONY: airgap-images
airgap-images: ## Export Docker container images into air-gap archive
	@echo "=== Saving Container Images for Air-Gap ==="
	mkdir -p $(AIRGAP_DIST_DIR)/images
ifeq ($(AIRGAP_INCLUDE_AI), true)
	@echo "Exporting full image set (Operator, UI, DR Runner, AI Engine, PostgreSQL, Registry)..."
	docker save $(OPERATOR_IMG) $(UI_IMG) $(DR_RUNNER_IMG) $(AI_IMG) $(METRICS_DB_IMG) $(REGISTRY_IMG) | gzip -c > $(AIRGAP_DIST_DIR)/images/vcop-airgap-images-v$(VERSION).tar.gz
else
	@echo "Exporting core image set (Operator, UI, DR Runner, PostgreSQL, Registry)..."
	docker save $(OPERATOR_IMG) $(UI_IMG) $(DR_RUNNER_IMG) $(METRICS_DB_IMG) $(REGISTRY_IMG) | gzip -c > $(AIRGAP_DIST_DIR)/images/vcop-airgap-images-v$(VERSION).tar.gz
endif
	@echo "Images saved to $(AIRGAP_DIST_DIR)/images/vcop-airgap-images-v$(VERSION).tar.gz"

.PHONY: airgap-pack
airgap-pack: airgap-clean airgap-manifests airgap-charts airgap-scripts airgap-images ## Build complete standalone air-gap distribution bundle
	@echo "=== Assembling Complete Air-Gap Bundle: $(AIRGAP_BUNDLE_NAME) ==="
	@echo "Calculating checksums of bundle components..."
	cd $(AIRGAP_DIST_DIR) && find . -type f ! -name "CHECKSUMS.txt" -exec sha256sum {} + | sort > CHECKSUMS.txt
	@echo "Creating final compressed tarball: dist/$(AIRGAP_BUNDLE_NAME).tar.gz..."
	cd dist && tar -czf $(AIRGAP_BUNDLE_NAME).tar.gz -C airgap .
	@echo "Generating SHA256 checksum for distribution bundle..."
	cd dist && sha256sum $(AIRGAP_BUNDLE_NAME).tar.gz > $(AIRGAP_BUNDLE_NAME).tar.gz.sha256
	@echo ""
	@echo "========================================================================="
	@echo " [✓] Air-Gap Distribution Bundle Created Successfully!"
	@echo " Archive:  dist/$(AIRGAP_BUNDLE_NAME).tar.gz"
	@echo " Checksum: dist/$(AIRGAP_BUNDLE_NAME).tar.gz.sha256"
	@echo " Contents: dist/airgap/CHECKSUMS.txt"
	@echo "========================================================================="

.PHONY: airgap-clean
airgap-clean: ## Clean air-gap build artifacts
	@echo "=== Cleaning Air-Gap Build Directory ==="
	rm -rf $(AIRGAP_DIST_DIR) dist/$(AIRGAP_BUNDLE_NAME).tar.gz dist/$(AIRGAP_BUNDLE_NAME).tar.gz.sha256

.PHONY: help
help: ## Display this help message
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)
