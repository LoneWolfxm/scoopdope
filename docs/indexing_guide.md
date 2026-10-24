# Governance Event Indexing & Reconstruction Guide

## Overview
This document specifies how downstream indexers and observability services ingest, decode, and reconstruct governance state from Soroban on-chain contract events emitted by `contracts/governance/src/lib.rs`.

---

## 1. Event Ingestion Pipeline

### Soroban RPC Endpoint
Indexers query the `getEvents` RPC method specifying the governance contract ID:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getEvents",
  "params": {
    "startLedger": 1000000,
    "filters": [
      {
        "type": "contract",
        "contractIds": ["<GOVERNANCE_CONTRACT_ID>"]
      }
    ],
    "pagination": {
      "limit": 100
    }
  }
}
```

---

## 2. Topic Schemas & Event Types

Every event follows a deterministic topic structure:
- **Topic 0**: Event Symbol (`Symbol`)
- **Topic 1**: Proposal / Upgrade ID (`u64`)
- **Topic 2** (Optional): Proposer / Voter Address (`Address`)

| Event Symbol | Topics | Payload Fields | Lifecycle Phase |
| :--- | :--- | :--- | :--- |
| `prop_new` | `[Symbol("prop_new"), id: u64, proposer: Address]` | `{ title, voting_end_ledger, created_at }` | Proposal Created |
| `vote` | `[Symbol("vote"), id: u64, voter: Address]` | `{ support: bool, weight: i128 }` | Vote Recorded |
| `exec` | `[Symbol("exec"), id: u64]` | `{ executed_at, votes_for, votes_against }` | Execution Settled |
| `upg_prop` | `[Symbol("upg_prop"), id: u64, proposer: Address]` | `{ contract_address, new_wasm_hash, voting_end_ledger }` | Upgrade Proposed |
| `upg_appr` | `[Symbol("upg_appr"), id: u64]` | `{ timelock_expiry_ledger }` | Timelock Activated |
| `upg_exec` | `[Symbol("upg_exec"), id: u64]` | `{ contract_address, new_wasm_hash }` | Upgrade Executed |

---

## 3. State Machine Reconstruction Rules

1. **Proposal Entity Initialization (`prop_new`):**
   - Insert new proposal record with `status = "Active"`, `votes_for = 0`, `votes_against = 0`.
2. **Vote Aggregation (`vote`):**
   - Record voter vote mapping `(proposal_id, voter) -> support`.
   - Update `votes_for += weight` if `support == true` else `votes_against += weight`.
   - Invariant: A voter may only cast one vote per proposal.
3. **Execution Finalization (`exec`):**
   - Transition proposal status to `"Executed"`. Record execution timestamp.
4. **Upgrade Timelock Progression (`upg_prop` -> `upg_appr` -> `upg_exec`):**
   - `upg_prop`: Status `"Proposed"`.
   - `upg_appr`: Status `"Approved"`. Record `timelock_expiry_ledger`. Disallow execution prior to current ledger >= `timelock_expiry_ledger`.
   - `upg_exec`: Status `"Executed"`.

---

## 4. Deduplication & Idempotency Rules

- **Event Key:** `(ledger_sequence, tx_hash, event_index)`.
- **Duplicate Protection:** Re-delivered events with identical event keys must be ignored.
- **Reorg Handling:** If `startLedger` reorgs, discard unconfirmed blocks and re-stream from the last finalized ledger checkpoint.
