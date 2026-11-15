# Architecture Specification: oenexa-wallet

> **Domain:** Fintech/Wallet  
> **Status:** APPROVED & ACTIVE  
> **Classification:** Enterprise Architecture Baseline  

## 1. Domain Purpose & Responsibilities
High-security financial wallet service managing double-entry account balances, asset transfers, and multi-currency user vaults

## 2. Architectural Boundaries & Invariants
- **Single Responsibility:** oenexa-wallet manages exclusively its bounded context.
- **Data Sovereignty:** Exclusively owns its datastore (db_oenexa_wallet). Zero cross-service database access.
- **Inter-service Communication:** Strictly via REST/gRPC synchronous APIs or CloudEvents asynchronous message bus.
- **Secret Management:** Dynamically fetched via Vault; zero static credentials.

## 3. Component Architecture & Data Flow
\\\mermaid
flowchart LR
    Client["Client / API Gateway"] -->|"REST / gRPC"| Service["oenexa-wallet"]
    Service -->|"Read/Write"| DB[("Private Datastore")]
    Service -->|"CloudEvents"| Kafka["Kafka / NATS Event Bus"]
\\\
"@

Write-IfMissing "ROADMAP.md" @"
# Roadmap: oenexa-wallet

## Q1 2026 - Q2 2026: Foundation & High Availability
- [x] Initial service scaffolding and domain interface definition.
- [x] GitOps pipeline integration via ArgoCD.
- [x] Enterprise observability (Prometheus/Grafana) integration.

## Q3 2026 - Q4 2026: Scale & Optimization
- [ ] Automated chaos engineering resilience validation.
- [ ] Post-quantum cryptography readiness audit.
- [ ] Multi-region active-active read replica support.