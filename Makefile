# Master Makefile for vCluster Center of Operations (vCOp)

OPERATOR_DIR = apps/vc-operator
UI_DIR = apps/ui
DEPLOY_DIR = deploy

OPERATOR_IMG ?= vops/vc-operator:v0.37.0
UI_IMG ?= vops/vc-operations-center:v0.37.0

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

##@ Building

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
docker-build: docker-build-operator docker-build-ui ## Build Docker images for Operator and UI

.PHONY: docker-build-operator
docker-build-operator:
	@echo "=== Building Operator Docker Image: $(OPERATOR_IMG) ==="
	cd $(OPERATOR_DIR) && docker build -t $(OPERATOR_IMG) .

.PHONY: docker-build-ui
docker-build-ui:
	@echo "=== Building UI Docker Image: $(UI_IMG) ==="
	cd $(UI_DIR) && docker build -t $(UI_IMG) .

##@ Deployment

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
deploy: deploy-crds deploy-rbac deploy-presets ## Deploy entire vCOp stack (CRD, RBAC, Operator, UI, Presets)
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
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)
