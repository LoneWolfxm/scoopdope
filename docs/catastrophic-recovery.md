# Catastrophic Failure Recovery Guide

## Backup strategies for database and Redis

A strong backup strategy is critical for restoring service after catastrophic failures.

### Database backups

- **Regular snapshots**: take daily or hourly backups of PostgreSQL data.
- **Point-in-time recovery (PITR)**: retain WAL archives long enough to recover to a precise moment.
- **Offsite storage**: copy backups to a separate region or provider to avoid a single-cloud failure.
- **Retention policy**: keep recent backups for fast recovery while retaining longer-term archives for compliance.
- **Backup verification**: regularly restore backups to test environments to confirm they are valid.

### Redis backups

- **RDB snapshots**: use Redis snapshots (`SAVE`/`BGSAVE`) for periodic persistent copies.
- **AOF persistence**: enable append-only file mode for more granular recovery and lower data loss.
- **Replication**: run Redis replicas in separate failure domains to support failover.
- **Export and archive**: periodically export critical Redis state to durable storage for longer-term recovery.

## Data restoration procedures

When restoring data, follow a documented and repeatable process.

### Database restoration

1. Identify the latest valid backup that meets the recovery point objective.
2. Restore the PostgreSQL data directory or import the backup file to a recovery instance.
3. Restore WAL archives as needed to reach the target recovery time.
4. Validate schema compatibility and migrate if necessary.
5. Run sanity checks on core data: user accounts, transaction history, contract references.
6. Promote the recovery instance only after the restored data is verified.

### Redis restoration

1. Stop writes to the affected Redis cluster to avoid data corruption.
2. Restore from the most recent RDB snapshot or AOF file.
3. Verify that critical keys, counters, and session data are present.
4. Restart Redis with persistence enabled and allow replicas to resynchronize.
5. Rebuild any transient state that cannot be recovered from persistence (for example, ephemeral cache entries).

## Contract state recovery process

Smart contracts and on-chain state require a separate recovery approach.

- **Verify chain state**: check the on-chain ledger to confirm the deployed contract version and current stored values.
- **Rehydrate off-chain state**: restore any application-side contract metadata from backups or event logs.
- **Reconcile with on-chain state**: compare on-chain contract state against cached state and database records.
- **Redeploy if needed**: if a contract deployment is corrupted or invalid, follow upgrade/change procedures carefully and notify stakeholders.

In environments with both on-chain and off-chain state, prioritize consistency and avoid forcing mismatched data back into the system.

## RTO and RPO definitions

Understanding recovery objectives guides planning and decision-making.

- **Recovery Time Objective (RTO)**: the maximum acceptable time for bringing the system back online after a failure.
- **Recovery Point Objective (RPO)**: the maximum acceptable data loss window measured in time.

Example targets:

- **Critical production**: RTO <= 1 hour, RPO <= 15 minutes
- **Standard production**: RTO <= 4 hours, RPO <= 1 hour
- **Non-critical environments**: RTO <= 24 hours, RPO <= 6 hours

Choose RTO and RPO values based on business impact, customer expectations, and operational ability.

## Incident response workflow

A calm, repeatable incident workflow reduces risk and speeds recovery.

1. **Detect**: monitor alerts, logs, and customer reports.
2. **Triage**: determine the impact, scope, and severity.
3. **Communicate**: announce the incident internally and externally with clear status updates.
4. **Contain**: stop the damage and prevent compounding failures.
5. **Recover**: restore backups, failover systems, or roll back changes.
6. **Validate**: confirm the system is healthy and core functionality is working.
7. **Review**: conduct a post-incident analysis, document findings, and update processes.

Document the responsible teams, escalation paths, and communication channels so everyone can act quickly when a catastrophic event occurs.

## Contract Deployment Rollback

Smart contract deployments are immutable once published on-chain, but failure scenarios require documented recovery paths.

### Detecting a failed deployment

A deployment failure occurs when:

1. **Wasm upload fails**: `stellar contract build` or `stellar contract deploy` exits with a non-zero code.
   - Check logs for: network timeouts, insufficient account balance, invalid credentials, or wasm compilation errors.

2. **Transaction rejected**: the Stellar network rejects the deployment transaction.
   - Signs: `TransactionResult::opERR_*, TransactionResult::txFAILED`, or timeout after 5 minutes without confirmation.

3. **Contract fails to initialize**: the contract deploys but `initialize()` or setup calls fail.
   - Check: on-chain event logs and contract state queries return errors or unexpected values.

4. **Incorrect network deployed**: contract is published to testnet when mainnet was intended (or vice versa).
   - Verify: `soroban_env` address and contract ID in env file match the expected network.

### Pre-deployment checks

Before rolling back, confirm the failure:

```bash
# 1. Verify the failed contract hash (testnet example)
stellar network use testnet
stellar contract info --id <CONTRACT_ID_THAT_FAILED>

# Expected: contract not found, or state is inconsistent with intended values

# 2. Confirm the previous working version's hash
stellar contract info --id <PREVIOUS_CONTRACT_ID>

# Expected: contract is on-chain and responding to queries

# 3. Check account balance (must have funds for re-deployment)
stellar account info <STELLAR_SECRET_KEY>

# Expected: balance > 10 XLM (for wasm upload and deploy costs)
```

### Rollback procedure (re-deploy previous version)

1. **Checkout the previous working commit**:
   ```bash
   git log --oneline contracts/analytics/
   git checkout <PREVIOUS_COMMIT_HASH> -- contracts/analytics/
   ```

2. **Re-build the previous contract version**:
   ```bash
   cargo build --manifest-path contracts/analytics/Cargo.toml --target wasm32-unknown-unknown --release
   ```

3. **Deploy the previous version**:
   ```bash
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/scoopdope_analytics.wasm \
     --source-account <STELLAR_SECRET_KEY> \
     --network testnet
   ```
   - Output: `Contract deployed successfully. ID: <NEW_CONTRACT_ID>`

4. **Verify the re-deployed contract**:
   ```bash
   stellar contract invoke \
     --id <NEW_CONTRACT_ID> \
     --source-account <STELLAR_SECRET_KEY> \
     --network testnet \
     -- initialize \
     --admin <ADMIN_ADDRESS>
   
   # Expected: initialization succeeds or returns idempotent success
   ```

5. **Record the contract hash**:
   ```bash
   stellar contract info --id <NEW_CONTRACT_ID> | grep -i wasm_hash
   # Output: wasm_hash: abc123def456...
   ```

### Updating backend configuration

After re-deployment, update the backend environment variables to point to the new contract:

1. **Update .env or deployment config**:
   ```bash
   # .env or infra/docker-compose.prod.yml
   CONTRACT_ID_ANALYTICS=<NEW_CONTRACT_ID>
   CONTRACT_ID_TOKEN=<NEW_CONTRACT_ID>  # if token contract was also redeployed
   ```

2. **Verify the backend can connect**:
   ```bash
   # Restart backend and check logs
   docker compose up -d --build backend
   docker compose logs -f backend | grep -i contract
   
   # Expected: "Contract ID resolved successfully" or similar success message
   ```

3. **Test end-to-end**:
   ```bash
   # Call a backend endpoint that interacts with the contract
   curl -X GET http://localhost:3000/api/v1/stellar/balance/<PUBLIC_KEY>
   
   # Expected: HTTP 200 with balance data, not contract errors
   ```

### When to preserve the failed deployment

In some cases, **do not roll back**:

- **Partial failure**: only initialization failed, but the contract is on-chain and queryable. Retry initialization instead of re-deploying.
- **Data loss risk**: if the failed contract recorded important state (e.g., user progress), re-deploying will reset that state. Consult business stakeholders before proceeding.
- **Regulatory hold**: if the contract is under audit or investigation, freezing it may be required.

### Communicating the rollback

1. **Alert stakeholders immediately**: notify the platform team, customer support, and users.
2. **Status page update**: mark the Stellar integration as "degraded" until re-deployment is complete.
3. **Post-mortem**: document the failure cause and preventive measures (e.g., better pre-deployment testing, account balance alerts).

### Prevention: pre-deployment checklist

To reduce rollback frequency:

- [ ] Test the contract on testnet at least 24 hours before mainnet deployment.
- [ ] Verify the deployment account has > 50 XLM balance.
- [ ] Confirm the network parameter matches the target (testnet vs. mainnet).
- [ ] Run `stellar contract build --target wasm32-unknown-unknown` without errors.
- [ ] Verify the contract hash with a previous successful deployment to catch bytecode regressions.
- [ ] Have a mainnet rollback plan documented and tested on testnet.
- [ ] Set up alerts for failed contract operations (initialize, update, etc.).

## Stellar Key Compromise

The `STELLAR_SECRET_KEY` is used for credential issuance and reward minting. If it is exposed, an attacker can drain the treasury, mint unlimited rewards, and issue fraudulent credentials. Treat any suspected exposure as a **SEV-1** incident and follow this runbook immediately.

### Immediate response (first 15 minutes)

1. **Declare the incident**: page the on-call engineer and the Security Lead via the incident channel. Open an incident ticket and start a timeline log.
2. **Contain the damage**:
   - Pause the token contract (see [Freezing the token contract](#freezing-the-token-contract)) to stop further mints and transfers.
   - Revoke the compromised key from any CI/CD secret stores and rotate it (see [Key rotation procedure](#key-rotation-procedure)).
   - Disable any automated jobs (reward minting, credential issuance) that use the key.
3. **Preserve evidence**: do not delete logs. Export backend logs, Stellar Horizon transaction history, and secret-manager audit logs for the compromised key.
4. **Assess exposure**: determine how the key leaked (committed to git, leaked in logs, compromised host, third-party breach) and whether other secrets are affected.
5. **Notify**: inform the Security Lead and platform owner; prepare user communications (see [User notification](#user-notification)).

### Key rotation procedure

Rotate the key in every environment (local, staging, production). Never reuse the compromised key.

1. **Generate a new keypair**:
   ```bash
   stellar keys generate scoopdope-issuer-$(date +%Y%m%d) --network mainnet
   stellar keys address scoopdope-issuer-$(date +%Y%m%d)
   # Output: G... (new public key)
   ```
2. **Fund the new account** with enough XLM for transaction fees and reserves:
   ```bash
   stellar account fund <NEW_PUBLIC_KEY>   # testnet only
   # mainnet: transfer XLM from the treasury/ops account
   ```
3. **Transfer required roles**: if the old key held admin/issuer roles on the token or credential contracts, grant those roles to the new public key (e.g. `set_admin`, `add_minter`) and then remove the old key's roles.
4. **Update secrets in the secret manager** (never in plaintext files or git):
   ```bash
   # Example using the platform secret manager CLI
   secret-manager set STELLAR_SECRET_KEY --env production --value "<NEW_SECRET>"
   secret-manager set STELLAR_SECRET_KEY --env staging --value "<NEW_SECRET>"
   ```
   Update `STELLAR_PUBLIC_KEY` alongside it so services validate against the new key.
5. **Rolling deploy without downtime**:
   - Deploy the new secret to one instance at a time (rolling update), waiting for health checks to pass before continuing.
   - Keep the old key valid only until all instances report the new public key; then revoke it.
   ```bash
   docker compose up -d --no-deps --scale backend=2 backend   # rolling restart
   docker compose logs -f backend | grep -i "stellar.*key"
   # Expected: services log the new public key and pass health checks
   ```
6. **Verify**: confirm new mints/issuances are signed by the new key and the old key can no longer sign.
7. **Unpause** the token contract once the new key is live and verified (see below).

### Freezing the token contract

The token contract implements the shared contract's pause mechanism. Pausing blocks mints, transfers, and reward issuance while leaving read-only queries available.

1. **Pause** (requires the pauser/admin role):
   ```bash
   stellar contract invoke \
     --id <TOKEN_CONTRACT_ID> \
     --source-account <ADMIN_SECRET_KEY> \
     --network mainnet \
     -- pause
   ```
2. **Verify paused state**:
   ```bash
   stellar contract invoke --id <TOKEN_CONTRACT_ID> --network mainnet -- is_paused
   # Expected: true
   ```
3. **Unpause** after the incident is resolved and the new key is verified:
   ```bash
   stellar contract invoke \
     --id <TOKEN_CONTRACT_ID> \
     --source-account <ADMIN_SECRET_KEY> \
     --network mainnet \
     -- unpause
   ```
4. **Test the pause mechanism** on testnet before relying on it in production, and re-test after every contract upgrade.

### On-chain damage assessment

After containment, quantify what the attacker did using Horizon and contract queries:

```bash
# Treasury balance of the compromised key
stellar account info <COMPROMISED_PUBLIC_KEY>

# Recent transactions signed by the compromised key (last 24h)
curl "https://horizon.stellar.org/accounts/<COMPROMISED_PUBLIC_KEY>/transactions?order=desc&limit=200"

# Token balances for affected accounts
stellar contract invoke --id <TOKEN_CONTRACT_ID> --network mainnet -- balance --id <ACCOUNT>

# Total supply (detect unauthorized mints)
stellar contract invoke --id <TOKEN_CONTRACT_ID> --network mainnet -- total_supply
```

Record: unauthorized mints, transfers out of the treasury, fraudulent credentials issued, and the time window of attacker activity. Attach findings to the incident ticket.

### User notification

1. **Internal**: notify support, community managers, and leadership within 1 hour of confirmation.
2. **Affected users**: notify users whose credentials or rewards were affected, describing what happened, what was done, and any action required (e.g. re-issuance of credentials).
3. **Public**: publish a status-page update and, if funds were lost, a public post-mortem after remediation.
4. **Regulatory**: consult legal on any disclosure obligations.

### Quarterly key compromise drill

- **Owner**: Security Lead (backup: Platform On-Call Lead).
- **Schedule**: first week of each quarter (Jan, Apr, Jul, Oct); results reviewed in the following security sync.
- **Scope**: simulate key exposure in staging — pause the token contract, rotate the key, rolling deploy, verify, unpause, and run the damage-assessment queries.
- **Output**: drill report with timings against RTO, gaps found, and runbook updates. Track action items to completion.
=======
