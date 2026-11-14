# OENEXA Wallet Service (`oenexa-wallet`)

> **Sovereign Multi-Asset Custody, Ledger & Quantum Shielded Notes Service**  
> Governed by the OENEXA FinTech & Blockchain Architecture Organizations.

## 1. Domain Ownership
This repository authoritatively owns the **Wallet & Custody Domain**:
- **Owned Data**: User Accounts, Multi-Asset Balances (ONXC, USDT, BTC, ETH), Deposit Records, Withdrawal Ledger, Quantum Shielded Notes commitments.
- **Owned APIs**: `POST /v1/wallets`, `GET /v1/wallets/me/balances`, `POST /v1/wallets/withdrawals`, `POST /v1/wallets/shielded-notes`.
- **Owned Events**: `com.oenexa.wallet.account.created.v1`, `com.oenexa.wallet.deposit.detected.v1`, `com.oenexa.wallet.withdrawal.settled.v1`.
- **Database Boundary**: Isolated `oenexa-wallet-prod-db`. Zero shared databases.

## 2. Ledger Standards
- **Double-Entry Bookkeeping**: Strict invariant where sum of debits equals sum of credits.
- **Zero Fractional Drift**: BigInt / fixed-point arithmetic with 8-decimal precision.
- **Quantum-Shielded Commitments**: Pederson-style hash commitments with blake2b/sha256 nullifiers.
