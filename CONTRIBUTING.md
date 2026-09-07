# Contributing to vCOp

First off, thank you for considering contributing to **vCOp (Virtual Cluster Operations Center)**! It's people like you that make open source such a fantastic environment to learn, build, and innovate.

vCOp is an open-source, cloud-native platform designed to manage high-density, multi-tenant virtual clusters on Kubernetes at scale.

This project is founded and maintained by **Juan Felix-Falcon** ([@jfelixfalcon](https://github.com/jfelixfalcon)).

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [How Can I Contribute?](#how-can-i-contribute)
   - [Reporting Bugs](#reporting-bugs)
   - [Suggesting Enhancements](#suggesting-enhancements)
   - [Pull Requests](#pull-requests)
3. [Local Development Environment](#local-development-environment)
   - [Prerequisites](#prerequisites)
   - [Repository Structure](#repository-structure)
   - [Running the Go Operator](#running-the-go-operator)
   - [Running the Astro UI](#running-the-astro-ui)
   - [Testing in a Local Kind Cluster](#testing-in-a-local-kind-cluster)
4. [Testing & Quality Assurance](#testing--quality-assurance)
5. [Commit Message Guidelines](#commit-message-guidelines)
6. [License & Contributor Terms](#license--contributor-terms)

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone. Please treat fellow contributors with respect and kindness regardless of background or experience level.

---

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check existing GitHub Issues to see if the issue has already been reported.

When opening an issue, please include:
- **A clear, descriptive title**.
- **Steps to reproduce the behavior**.
- **Expected vs. actual behavior**.
- **Cluster & Environment Details**:
  - Kubernetes version (e.g. `v1.31.0` / Kind)
  - vCOp version (e.g. `v1.2.0`)
  - Relevant pod logs (`kubectl logs -n vcop-system -l app.kubernetes.io/name=vcop-operator`)
  - VirtualCluster CR manifest (`kubectl get vc <name> -o yaml`)

### Suggesting Enhancements

Feature requests are welcome! When opening an enhancement issue:
- Explain **why** the feature would be useful to developers, platform engineers, or DevOps teams.
- Describe the proposed workflow or API changes (`VirtualCluster` CRD spec/status).
- Provide architectural context, mockups, or diagrams where applicable.

### Pull Requests

1. **Fork the repo** and create your branch from `main`:
   ```bash
   git checkout -b feat/my-awesome-feature
   ```
2. **Make your changes** following project code conventions.
3. **Run tests** and verify everything passes cleanly.
4. **Commit your changes** using [Conventional Commits](#commit-message-guidelines).
5. **Push to your fork** and open a Pull Request against the `main` branch of `jfelixfalcon/vcop`.
6. Provide a clear description in your PR of what was changed, why, and how it was tested.

---

## Local Development Environment

### Prerequisites

- **Go**: `1.22+` (with `GOPATH` and `GOBIN` configured)
- **Node.js**: `v22+` and `npm`
- **Docker**: `24+` (or compatible container runtime)
- **kubectl**: `v1.28+`
- **Helm**: `v3.12+`
- **Kind**: `v0.22+` (for local multi-cluster testing)

### Repository Structure

```
vcop/
├── apps/
│   ├── vc-operator/       # Go Operator (controller-runtime, CRDs, reconcilers)
│   │   ├── api/v1alpha1/  # VirtualCluster CRD definitions
│   │   ├── controllers/   # Etcd, Addons, Istio, Quota, RBAC reconcilers
│   │   └── pkg/           # Webhook, syncer, and client utilities
│   └── ui/                # Astro + React Operations Center dashboard
│       ├── src/components # UI components (UpgradeModal, Wizards, Dashboards)
│       └── src/pages      # Astro routes and backend API endpoints
├── charts/
│   ├── vcop/              # Main vCOp Operator & UI Helm chart
│   └── vcluster-istio/    # Opinionated Istio Ingress Gateway chart
├── deploy/                # Standalone raw Kubernetes manifests & CRDs
└── Makefile               # Developer automation targets
```

### Running the Go Operator

Run the operator locally against your current kubeconfig context:
```bash
make dev-operator
# or
cd apps/vc-operator && go run ./main.go
```

### Running the Astro UI

Run the Operations Center frontend in live reload mode:
```bash
make dev-ui
# or
cd apps/ui && npm install && npm run dev
```
Open `http://localhost:4321` in your browser.

### Testing in a Local Kind Cluster

1. **Create a local Kind cluster**:
   ```bash
   kind create cluster --name kind
   ```
2. **Apply CRDs & Base Manifests**:
   ```bash
   make deploy-crds
   make deploy-rbac
   make deploy-presets
   ```
3. **Build & load container images**:
   ```bash
   make docker-build
   make kind-load
   ```
4. **Deploy the stack**:
   ```bash
   make deploy
   ```

---

## Testing & Quality Assurance

All PRs must pass unit tests, builds, and linting before merge:

- **Run Go Operator unit tests**:
  ```bash
  make test-operator
  # or
  cd apps/vc-operator && go test -v ./...
  ```
- **Build the UI production bundle**:
  ```bash
  cd apps/ui && npm run build
  ```
- **Lint Helm Charts**:
  ```bash
  make helm-lint
  helm lint charts/vcluster-istio
  ```

---

## Commit Message Guidelines

We adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` A new feature (e.g. `feat(upgrade): support etcd and coredns in upgrade matrix`)
- `fix:` A bug fix (e.g. `fix(istio): default gateway service type to ClusterIP`)
- `docs:` Documentation changes (e.g. `docs: update architecture diagrams in README`)
- `chore:` Maintenance, dependency bumps, or releases (e.g. `chore(release): bump version to 1.2.0`)
- `refactor:` Code refactoring with no behavioral change
- `test:` Adding or updating tests

---

## License & Contributor Terms

By contributing to **vCOp**, you agree that your contributions will be licensed under the project's **[Apache License, Version 2.0](LICENSE)**.

---

### Questions or Need Help?

Feel free to reach out or connect with the maintainer:
- **Juan Felix-Falcon** ([@jfelixfalcon](https://github.com/jfelixfalcon)) — <jfelixfalcon@gmail.com>
- Open a discussion or issue on [GitHub Discussions / Issues](https://github.com/jfelixfalcon/vcop/issues).
