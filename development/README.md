# Local Dev Environment: Gateway API, Keycloak & VCOP UI

This directory contains the Kubernetes manifests and configuration scripts for running **Kubernetes Gateway API (Envoy Gateway)**, **Keycloak with persistent PostgreSQL**, and **VCOP UI** over **TLS (`.local` domains)** on a local **Kind** cluster.

---

## 📁 File Structure

| File | Description |
|---|---|
| [`01-metallb.yaml`](./01-metallb.yaml) | MetalLB `IPAddressPool` (`172.18.255.200 - 172.18.255.250`) and `L2Advertisement`. |
| [`02-certificates-and-ca.yaml`](./02-certificates-and-ca.yaml) | Root CA `local-dev-ca`, `ClusterIssuer` `local-ca-issuer`, and TLS certificates for Gateway and Keycloak. |
| [`03-postgres-db.yaml`](./03-postgres-db.yaml) | PostgreSQL database deployment with `postgres-db-data` `PersistentVolumeClaim` (fixes data loss on restarts). |
| [`04-keycloak.yaml`](./04-keycloak.yaml) | `Keycloak` Custom Resource configured for hostname `keycloak.local` and connecting to `postgres-service`. |
| [`05-gateway-api.yaml`](./05-gateway-api.yaml) | `GatewayClass`, `Gateway` (HTTP 80, HTTPS 443, HTTPS 8443), `HTTPRoute`s (with 301 HTTPS redirects), and `BackendTLSPolicy`. |
| [`06-coredns.yaml`](./06-coredns.yaml) | CoreDNS ConfigMap adding in-cluster DNS resolution for `vcop.local` and `keycloak.local` to Gateway IP. |
| [`all-in-one.yaml`](./all-in-one.yaml) | Single aggregated manifest containing all component resources for one-step application. |
| [`setup.sh`](./setup.sh) | Automated bash script to install, apply, trust local CA, and configure hosts. |

---

## 🌐 Network & Domain Mapping

* **Gateway IP:** `172.18.255.200` (Assigned by MetalLB on Docker bridge `172.18.0.0/16`)
* **Host `/etc/hosts`:**
  ```text
  172.18.255.200 vcop.local keycloak.local
  ```

### Access URLs
* **VCOP UI:** [https://vcop.local](https://vcop.local) *(HTTP `http://vcop.local` automatically redirects with `301 Moved Permanently` to HTTPS)*
* **Keycloak Admin Console:** [https://keycloak.local/admin/](https://keycloak.local/admin/) *(HTTP `http://keycloak.local` redirects to HTTPS)*
* **Keycloak Port 8443 (Optional):** [https://keycloak.local:8443/admin/](https://keycloak.local:8443/admin/)

---

## 🔒 TLS & Trust

1. A self-signed local Root CA (`Local Development Root CA`) was generated using cert-manager.
2. The CA is installed into `/etc/ca-certificates/trust-source/anchors/` and registered with `update-ca-trust`.
3. Certificates for `vcop.local`, `keycloak.local`, and `*.local` are signed by this CA.
4. Your browser and local `curl` trust these endpoints natively (no self-signed warning, no `-k` required).

---

## 💾 Persistent Storage Fix for Keycloak

* **Issue:** Keycloak appeared to lose state on restart because `deployment.apps/postgres-db` had no Persistent Volume Claim attached, causing PostgreSQL to initialize in the temporary container overlay layer. Any restart or reboot wiped the database.
* **Solution:** Attached `PersistentVolumeClaim/postgres-db-data` (5Gi) mounted to `/var/lib/postgresql/data` with `PGDATA=/var/lib/postgresql/data/pgdata` and `strategy: Recreate`.

---

## 🚀 Quick Deployment

To deploy or restore the entire setup:

```bash
cd ~/Documents/dev
./setup.sh
```

Or manually:

```bash
kubectl apply -f ~/Documents/dev/all-in-one.yaml
```

---

## 📜 Exported Certificate Files

The generated certificates and private keys are saved in [`certs/`](./certs/):

* [`local-dev-ca.crt`](./certs/local-dev-ca.crt) & [`local-dev-ca.key`](./certs/local-dev-ca.key): Root CA certificate and private key.
* [`gateway-tls.crt`](./certs/gateway-tls.crt) & [`gateway-tls.key`](./certs/gateway-tls.key): Gateway TLS certificate (SANs: `vcop.local`, `keycloak.local`, `*.local`, `localhost`).
* [`keycloak-tls.crt`](./certs/keycloak-tls.crt) & [`keycloak-tls.key`](./certs/keycloak-tls.key): Keycloak backend TLS certificate.

### Importing the Root CA to Browsers / Other Devices
To trust `*.local` domains on another device or browser:
1. Import [`local-dev-ca.crt`](./local-dev-ca.crt) as an **Authorities / Trusted Root CA**.
