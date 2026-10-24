# Frozen Governance ABI Specification

Status: Frozen
Version: 1.0.0
Protocol: Soroban Protocol 27

## Event Schemas

### 1. `PROPOSAL_CREATED` (`prop_new`)
- **Topics**: `[Symbol("prop_new"), proposal_id: u64, proposer: Address]`
- **Data**:
  ```json
  {
    "title": "String",
    "voting_end_ledger": "u32",
    "created_at": "u64"
  }
  ```

### 2. `VOTE_CAST` (`vote`)
- **Topics**: `[Symbol("vote"), proposal_id: u64, voter: Address]`
- **Data**:
  ```json
  {
    "support": "bool",
    "weight": "i128"
  }
  ```

### 3. `PROPOSAL_EXECUTED` (`exec`)
- **Topics**: `[Symbol("exec"), proposal_id: u64]`
- **Data**:
  ```json
  {
    "executed_at": "u64",
    "votes_for": "i128",
    "votes_against": "i128"
  }
  ```

### 4. `UPGRADE_PROPOSED` (`upg_prop`)
- **Topics**: `[Symbol("upg_prop"), upgrade_id: u64, proposer: Address]`
- **Data**:
  ```json
  {
    "contract_address": "Address",
    "new_wasm_hash": "BytesN<32>",
    "voting_end_ledger": "u32"
  }
  ```

### 5. `UPGRADE_APPROVED` (`upg_appr`)
- **Topics**: `[Symbol("upg_appr"), upgrade_id: u64]`
- **Data**:
  ```json
  {
    "timelock_expiry_ledger": "u32"
  }
  ```

### 6. `UPGRADE_EXECUTED` (`upg_exec`)
- **Topics**: `[Symbol("upg_exec"), upgrade_id: u64]`
- **Data**:
  ```json
  {
    "contract_address": "Address",
    "new_wasm_hash": "BytesN<32>"
  }
  ```
