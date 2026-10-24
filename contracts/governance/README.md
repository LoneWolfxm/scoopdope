# Governance Contract

Smart contract implementing decentralized governance with time-locked upgrade proposals.

## Overview

The governance contract enables token holders to:
- Create and vote on governance proposals
- Propose and vote on contract upgrades
- Execute approved upgrades after a mandatory time-lock period

## Features

### Governance Proposals

Standard governance proposals allow the community to decide on protocol changes:

- **Create Proposal**: Any token holder can propose an idea
- **Voting Period**: Defined by `voting_end_ledger`
- **Execution**: Requires `votes_for > votes_against`

### Contract Upgrades with Time-Lock

Critical to preventing sudden, potentially malicious upgrades, the contract enforces a mandatory delay:

1. **Proposal Phase**: Proposer submits upgrade with:
   - Target contract address
   - New WASM hash
   - Voting deadline
   - **Time-lock delay** (minimum blocks between quorum and execution)

2. **Voting Phase**: Token holders vote yes/no
   - Voting power determined by token balance
   - Must achieve `votes_for > votes_against`

3. **Approval Phase**: Once voting ends and quorum is met:
   - Upgrade transitions to "approved" state
   - Time-lock countdown begins
   - `executable_after` = current_ledger + timelock_ledgers

4. **Execution Phase**: After time-lock expires:
   - Any account can execute the approved upgrade
   - **Assertion**: `current_ledger >= executable_after`
   - Contract receives new WASM hash via upgrade method

## Time-Lock Mechanism

### Configuration

Time-lock duration is configured during contract initialization:

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    token_contract: Address,
    timelock_ledgers: u32,  // Blocks between approval and execution
)
```

### Example Timeline

**Scenario**: 24-hour time-lock (approximately 10,368 ledger blocks assuming 8.3 second block time)

```
Block 1000: Upgrade proposed (voting_end_ledger = 1100)
Block 1101: Voting ends, votes counted, upgrade approved
            ↓ executable_after = Block 1101 + 10368 = Block 11469
Block 6234: User attempts to execute → FAILS (Timelock not expired)
Block 11469: User attempts to execute → SUCCEEDS
Block 11470: Subsequent execution attempts → FAIL (Already executed)
```

### Purpose

1. **User Protection**: Users have time to:
   - Withdraw from protocol if they disagree with upgrade
   - Review new code and security implications
   - Migrate to alternative protocols if necessary

2. **Security Buffer**: Community has time to:
   - Audit new smart contract code
   - Detect and respond to malicious upgrades
   - Coordinate emergency measures if needed

3. **Multi-Signature Escape Hatch**: If upgrade is clearly malicious:
   - Admin can create counter-proposal
   - Disable the original upgrade (future enhancement)
   - Revert to previous version after execution (if supported)

## Arithmetic Types

All vote count, quorum, and supply arithmetic in this contract uses `i128` rather than `u32`.

### Rationale

- **Overflow safety**: Quorum calculations multiply the total voter count by a percentage value. With `u32`, this overflows once the voter count exceeds roughly 42 million. Using `i128` makes such overflows practically impossible and future-proofs the contract against large voter sets.
- **Token contract conventions**: Token and governance contracts across the ecosystem standardize on `i128` for balances and vote counts. Matching that convention keeps the governance contract consistent with the token contract it reads voting power from and avoids lossy conversions at the boundary.
- **Signed semantics**: `i128` is the native type for token amounts in Soroban token contracts, so vote tallies (`votes_for`, `votes_against`) and supply figures share the same representation.

### Checked Arithmetic

All arithmetic on these values uses checked operations (e.g. `checked_mul`, `checked_add`) and returns an explicit error instead of panicking on overflow. This guarantees that even adversarial or extreme inputs cannot cause an arithmetic panic; they surface as a contract error instead.

## Data Storage

### Proposal Records

```rust
pub struct ProposalRecord {
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub voting_end_ledger: u32,
    pub votes_for: i128,
    pub votes_against: i128,
    pub executed: bool,
    pub created_at: u64,
}
```

### Upgrade Proposal Records

```rust
pub struct UpgradeProposalRecord {
    pub id: u64,
    pub proposer: Address,
    pub contract_address: Address,
    pub new_wasm_hash: BytesN<32>,
    pub voting_end_ledger: u32,
    pub votes_for: i128,
    pub votes_against: i128,
    pub approved: bool,
    pub executed: bool,
    pub timelock_ledger: u32,        // Deadline for execution
    pub created_at: u64,
}
```

## API Reference

### Admin Functions

#### `initialize(env, admin, token_contract, timelock_ledgers)`
Initialize governance contract with configuration.

**Parameters:**
- `admin` (Address): Admin account
- `token_contract` (Address): Token contract for voting power
- `timelock_ledgers` (u32): Blocks between approval and execution

**Errors:**
- "Already initialized" — Contract already configured
- "Timelock must be greater than 0" — Timelock duration invalid

#### `get_admin(env) → Address`
Retrieve the admin address.

#### `get_timelock_ledgers(env) → u32`
Retrieve the configured time-lock duration.

### Proposal Functions

#### `create_proposal(env, proposer, title, description, voting_end_ledger) → u64`
Create a governance proposal.

**Returns:** Proposal ID

#### `vote(env, voter, proposal_id, support)`
Cast a vote on a proposal.

**Parameters:**
- `support` (bool): `true` for yes, `false` for no
- Voting power = token balance at voting time

#### `execute_proposal(env, proposal_id)`
Execute a proposal after voting ends.

**Assertions:**
- Voting period must be over
- Proposal must pass (votes_for > votes_against)

### Upgrade Functions

#### `propose_upgrade(env, proposer, contract_address, new_wasm_hash, voting_end_ledger, timelock_ledger) → u64`
Propose a contract upgrade.

**Parameters:**
- `contract_address` (Address): Target contract to upgrade
- `new_wasm_hash` (BytesN<32>): WASM binary hash
- `timelock_ledger` (u32): Earliest block for execution
- `timelock_ledger` must be > `voting_end_ledger`

**Returns:** Upgrade ID

#### `vote_upgrade(env, voter, upgrade_id, support)`
Vote on an upgrade proposal.

#### `approve_upgrade(env, upgrade_id)`
Approve an upgrade after voting (marks as ready for execution queue).

**Assertions:**
- Voting must be complete
- Must achieve quorum (votes_for > votes_against)
- Sets `executable_after` timestamp

#### `execute_upgrade(env, upgrade_id)`
Execute an approved upgrade (invokes `upgrade()` on target contract).

**Assertions:**
- Upgrade must be approved
- Must be called only once
- **`current_ledger >= timelock_ledger`** — Time-lock must be expired

#### `get_upgrade_proposal(env, upgrade_id) → Option<UpgradeProposalRecord>`
Retrieve upgrade proposal details.

## Events

| Event | Details |
|-------|---------|
| `prop_new` | Proposal created (id, proposer, timelock) |
| `vote` | Vote cast (proposal_id, voter, support) |
| `exec` | Proposal executed (id) |
| `upg_prop` | Upgrade proposed (id, contract, wasm_hash) |
| `upg_appr` | Upgrade approved, entering time-lock (id, contract) |
| `upg_exec` | Upgrade executed (id, contract) |

## Testing

Comprehensive test suite validates:
- ✅ Time-lock enforcement (fails before expiry)
- ✅ Execution at threshold (succeeds at exact expiry)
- ✅ Execution after expiry (succeeds after timelock)
- ✅ Double-execution prevention
- ✅ Voting period validation
- ✅ Quorum requirements

Run tests:
```bash
cargo test --lib
```

## Security Considerations

1. **Admin Authority**: Admin can create emergency counter-proposals
2. **Upgrade Finality**: Once executed, upgrade is permanent (within contract lifecycle)
3. **No Rollback**: Contract does not auto-rollback failed upgrades (handled at deployment level)
4. **Token Voting Power**: Voting power = current token balance (historical balance not tracked)

## Integration

### Target Contract Requirements

Contracts receiving upgrades must implement:

```rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>)
```

This function receives the new WASM hash and updates the contract code.

## References

- [Stellar Smart Contracts](https://developers.stellar.org/docs/smart-contracts)
- [Soroban SDK](https://docs.rs/soroban-sdk/)
- [Governance Best Practices](https://forum.stellar.org/)
