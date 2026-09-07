# Master Makefile for vCluster Center of Operations (vCOp)

OPERATOR_DIR = apps/vc-operator
UI_DIR = apps/ui
DEPLOY_DIR = deploy
CHART_DIR = charts/vcop
KIND_CLUSTER ?= kind

OPERATOR_IMG ?= vops/vc-operator:v1.3.0
UI_IMG ?= vops/vc-operations-center:v1.3.0
DR_RUNNER_IMG ?= vops/etcd-dr-runner:v1.3.0

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
docker-build: docker-build-operator docker-build-ui docker-build-dr-runner ## Build Docker images for Operator, UI, and DR runner

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

##@ Kind (Local Cluster Image Caching)

.PHONY: kind-load
kind-load: ## Cache and load built Docker images directly into Kind cluster
	@echo "=== Loading container images into Kind cluster ($(KIND_CLUSTER)) ==="
	kind load docker-image $(OPERATOR_IMG) --name $(KIND_CLUSTER)
	kind load docker-image $(UI_IMG) --name $(KIND_CLUSTER)
	kind load docker-image $(DR_RUNNER_IMG) --name $(KIND_CLUSTER)
	@echo "=== Container images cached in Kind containerd! ==="

##@ Helm Chart Management

.PHONY: helm-lint
helm-lint: ## Lint the vCOp Helm chart
	@echo "=== Linting vCOp Helm Chart ==="
	helm lint $(CHART_DIR)

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
	kubectl apply -f $(DEPLOY_DIR)/operator.yaml
	kubectl apply -f $(DEPLOY_DIR)/ui.yaml

.PHONY: undeploy
undeploy: ## Remove vCOp operator and UI from cluster
	kubectl delete -f $(DEPLOY_DIR)/ui.yaml --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/operator.yaml --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/presets/ --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/rbac/ --ignore-not-found
	kubectl delete -f $(DEPLOY_DIR)/crds/ --ignore-not-found

.PHONY: help
help: ## Display this help message
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)
