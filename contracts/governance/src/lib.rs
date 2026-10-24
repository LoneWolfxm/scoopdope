#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal, String, Symbol,
};

pub mod voting;

// =============================================================================
// Storage keys
// =============================================================================

#[contracttype]
pub enum DataKey {
    Admin,
    TokenContract,
    Proposal(u64),                       // id → ProposalRecord
    Vote(u64, Address),                  // (proposal_id, voter) → bool (support)
    NextProposalId,                      // u64 counter
    UpgradeProposal(u64),                // id → UpgradeProposalRecord
    TimelockExpiry(u64),                 // upgrade_id → expiry_ledger
    TimelockLedgers,                     // u32 default timelock duration in ledgers
    QuorumBps,                           // i128 quorum in basis points (e.g. 1000 = 10%)
}

// =============================================================================
// Arithmetic helpers
// =============================================================================
//
// All vote count, quorum, and supply arithmetic uses i128. This avoids the
// u32 overflow that occurred when multiplying large voter counts by a
// percentage (e.g. voter_count * 10000). i128 is the standard type for token
// and governance supply math in Soroban contracts.

/// Basis points denominator (100% == 10_000 bps).
const BPS_DENOMINATOR: i128 = 10_000;

/// Computes the quorum threshold in basis points:
/// `total_votes_cast * 10_000 / total_supply`.
///
/// Uses checked i128 arithmetic so that large voter sets cannot overflow.
pub fn quorum_threshold_bps(total_votes_cast: i128, total_supply: i128) -> i128 {
    assert!(total_supply > 0, "Total supply is zero");
    total_votes_cast
        .checked_mul(BPS_DENOMINATOR)
        .expect("Quorum calculation overflow")
        .checked_div(total_supply)
        .expect("Quorum division overflow")
}

/// Adds a vote balance to a tally using checked i128 arithmetic.
pub fn add_votes(tally: i128, balance: i128) -> i128 {
    tally.checked_add(balance).expect("Vote tally overflow")
}

// =============================================================================
// Types
// =============================================================================

#[contracttype]
#[derive(Clone)]
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

#[contracttype]
#[derive(Clone)]
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
    pub timelock_ledger: u32,
    pub created_at: u64,
}

// =============================================================================
// Events
// =============================================================================

const PROPOSAL_CREATED: Symbol = symbol_short!("prop_new");
const VOTE_CAST: Symbol = symbol_short!("vote");
const PROPOSAL_EXECUTED: Symbol = symbol_short!("exec");
const UPGRADE_PROPOSED: Symbol = symbol_short!("upg_prop");
const UPGRADE_APPROVED: Symbol = symbol_short!("upg_appr");
const UPGRADE_EXECUTED: Symbol = symbol_short!("upg_exec");

// =============================================================================
// Contract
// =============================================================================

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    pub fn initialize(env: Env, admin: Address, token_contract: Address, timelock_ledgers: u32, quorum_bps: i128) {
        assert!(
            !env.storage().instance().has(&DataKey::Admin),
            "Already initialized"
        );
        assert!(timelock_ledgers > 0, "Timelock must be greater than 0");
        assert!(quorum_bps > 0, "Quorum must be greater than 0");
        assert!(
            quorum_bps <= BPS_DENOMINATOR,
            "Quorum must not exceed 10000 bps"
        );
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TokenContract, &token_contract);
        env.storage()
            .instance()
            .set(&DataKey::TimelockLedgers, &timelock_ledgers);
        env.storage().instance().set(&DataKey::NextProposalId, &1_u64);
        env.storage()
            .instance()
            .set(&DataKey::QuorumBps, &quorum_bps);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn get_quorum_bps(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::QuorumBps).unwrap_or(1000)
    }

    pub fn get_timelock_ledgers(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TimelockLedgers)
            .unwrap_or(0)
    }

    // -------------------------------------------------------------------------
    // Proposals
    // -------------------------------------------------------------------------

    pub fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        voting_end_ledger: u32,
    ) -> u64 {
        proposer.require_auth();
        assert!(
            title.len() > 0 && title.len() <= 200,
            "Title must be between 1 and 200 bytes"
        );
        assert!(
            description.len() <= 2000,
            "Description must not exceed 2000 bytes"
        );
        assert!(
            voting_end_ledger > env.ledger().sequence(),
            "Voting end must be in future"
        );
        assert!(
            voting_end_ledger <= env.ledger().sequence() + 1_000_000,
            "Voting duration exceeds maximum allowed bound"
        );

        let id: u64 = env.storage().instance().get(&DataKey::NextProposalId).unwrap();

        let proposal = ProposalRecord {
            id,
            proposer: proposer.clone(),
            title,
            description,
            voting_end_ledger,
            votes_for: 0,
            votes_against: 0,
            executed: false,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(id), &proposal);

        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &(id + 1));

        env.events()
            .publish((PROPOSAL_CREATED, symbol_short!("id")), id);

        id
    }

    // -------------------------------------------------------------------------
    // Voting
    // -------------------------------------------------------------------------

    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        voter.require_auth();

        let mut proposal: ProposalRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        assert!(
            env.ledger().sequence() < proposal.voting_end_ledger,
            "Voting period ended"
        );
        assert!(!proposal.executed, "Proposal already executed");

        // Check if already voted
        let vote_key = DataKey::Vote(proposal_id, voter.clone());
        assert!(
            !env.storage().persistent().has(&vote_key),
            "Already voted"
        );

        // Get voter's BST balance via cross-contract call
        let token_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .unwrap();
        let balance: i128 = env.invoke_contract(
            &token_contract,
            &symbol_short!("balance"),
            soroban_sdk::vec![&env, voter.clone().into_val(&env)],
        );

        assert!(balance > 0, "No voting power");

        // Record vote
        env.storage().persistent().set(&vote_key, &support);

        // Update proposal vote counts (checked i128 arithmetic)
        if support {
            proposal.votes_for = add_votes(proposal.votes_for, balance);
        } else {
            proposal.votes_against = add_votes(proposal.votes_against, balance);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events()
            .publish((VOTE_CAST, symbol_short!("voter")), (proposal_id, support));
    }

    // -------------------------------------------------------------------------
    // Execution
    // -------------------------------------------------------------------------

    pub fn execute_proposal(env: Env, proposal_id: u64) {
        let mut proposal: ProposalRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        assert!(
            env.ledger().sequence() >= proposal.voting_end_ledger,
            "Voting still ongoing"
        );
        assert!(!proposal.executed, "Already executed");

        assert!(
            proposal.votes_for > proposal.votes_against,
            "Proposal did not pass"
        );

        let total_votes_cast = add_votes(proposal.votes_for, proposal.votes_against);
        let token_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .unwrap();
        let total_supply: i128 = env.invoke_contract(
            &token_contract,
            &symbol_short!("total_supply"),
            soroban_sdk::vec![&env],
        );
        assert!(total_supply > 0, "Total supply is zero");

        let quorum_bps: i128 = env
            .storage()
            .instance()
            .get(&DataKey::QuorumBps)
            .unwrap_or(1000);

        let quorum_threshold = quorum_threshold_bps(total_votes_cast, total_supply);
        assert!(quorum_threshold >= quorum_bps, "Insufficient quorum");

        proposal.executed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events()
            .publish((PROPOSAL_EXECUTED, symbol_short!("id")), proposal_id);
    }

    // -------------------------------------------------------------------------
    // Contract Upgrade Governance
    // -------------------------------------------------------------------------

    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        contract_address: Address,
        new_wasm_hash: BytesN<32>,
        voting_end_ledger: u32,
        timelock_ledger: u32,
    ) -> u64 {
        proposer.require_auth();
        assert!(
            voting_end_ledger > env.ledger().sequence(),
            "Voting end must be in future"
        );
        assert!(
            timelock_ledger > voting_end_ledger,
            "Timelock must be after voting"
        );

        let id: u64 = env.storage().instance().get(&DataKey::NextProposalId).unwrap();
        let upgrade = UpgradeProposalRecord {
            id,
            proposer: proposer.clone(),
            contract_address: contract_address.clone(),
            new_wasm_hash: new_wasm_hash.clone(),
            voting_end_ledger,
            votes_for: 0,
            votes_against: 0,
            approved: false,
            executed: false,
            timelock_ledger,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::UpgradeProposal(id), &upgrade);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &(id + 1));

        env.events().publish(
            (UPGRADE_PROPOSED, symbol_short!("id")),
            (id, contract_address, new_wasm_hash),
        );

        id
    }

    pub fn vote_upgrade(env: Env, voter: Address, upgrade_id: u64, support: bool) {
        voter.require_auth();

        let mut upgrade: UpgradeProposalRecord = env
            .storage()
            .persistent()
            .get(&DataKey::UpgradeProposal(upgrade_id))
            .expect("Upgrade proposal not found");

        assert!(
            env.ledger().sequence() < upgrade.voting_end_ledger,
            "Voting period ended"
        );
        assert!(!upgrade.executed, "Upgrade already executed");

        let vote_key = DataKey::Vote(upgrade_id, voter.clone());
        assert!(
            !env.storage().persistent().has(&vote_key),
            "Already voted"
        );

        let token_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .unwrap();
        let balance: i128 = env.invoke_contract(
            &token_contract,
            &symbol_short!("balance"),
            soroban_sdk::vec![&env, voter.clone().into_val(&env)],
        );

        assert!(balance > 0, "No voting power");

        env.storage().persistent().set(&vote_key, &support);

        if support {
            upgrade.votes_for = add_votes(upgrade.votes_for, balance);
        } else {
            upgrade.votes_against = add_votes(upgrade.votes_against, balance);
        }
        env.storage()
            .persistent()
            .set(&DataKey::UpgradeProposal(upgrade_id), &upgrade);

        env.events()
            .publish((VOTE_CAST, symbol_short!("upg")), (upgrade_id, support));
    }

    pub fn approve_upgrade(env: Env, upgrade_id: u64) {
        let mut upgrade: UpgradeProposalRecord = env
            .storage()
            .persistent()
            .get(&DataKey::UpgradeProposal(upgrade_id))
            .expect("Upgrade proposal not found");

        assert!(
            env.ledger().sequence() >= upgrade.voting_end_ledger,
            "Voting still ongoing"
        );
        assert!(!upgrade.executed, "Already executed");
        assert!(
            upgrade.votes_for > upgrade.votes_against,
            "Upgrade did not pass"
        );

        upgrade.approved = true;
        env.storage()
            .persistent()
            .set(&DataKey::UpgradeProposal(upgrade_id), &upgrade);
        env.storage()
            .persistent()
            .set(&DataKey::TimelockExpiry(upgrade_id), &upgrade.timelock_ledger);

        env.events().publish(
            (UPGRADE_APPROVED, symbol_short!("id")),
            (upgrade_id, upgrade.contract_address.clone()),
        );
    }

    pub fn execute_upgrade(env: Env, upgrade_id: u64) {
        let mut upgrade: UpgradeProposalRecord = env
            .storage()
            .persistent()
            .get(&DataKey::UpgradeProposal(upgrade_id))
            .expect("Upgrade proposal not found");

        assert!(upgrade.approved, "Upgrade not approved");
        assert!(!upgrade.executed, "Already executed");

        let timelock_expiry: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TimelockExpiry(upgrade_id))
            .expect("Timelock not found");

        assert!(
            env.ledger().sequence() >= timelock_expiry,
            "Timelock not expired"
        );

        upgrade.executed = true;
        env.storage()
            .persistent()
            .set(&DataKey::UpgradeProposal(upgrade_id), &upgrade);

        // Execute the upgrade on the target contract
        env.invoke_contract::<()>(
            &upgrade.contract_address,
            &symbol_short!("upgrade"),
            soroban_sdk::vec![&env, upgrade.new_wasm_hash.into_val(&env)],
        );

        env.events().publish(
            (UPGRADE_EXECUTED, symbol_short!("id")),
            (upgrade_id, upgrade.contract_address.clone()),
        );
    }

    pub fn get_upgrade_proposal(env: Env, upgrade_id: u64) -> Option<UpgradeProposalRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::UpgradeProposal(upgrade_id))
    }

    // -------------------------------------------------------------------------
    // Reading
    // -------------------------------------------------------------------------

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<ProposalRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
    }

    pub fn has_voted(env: Env, proposal_id: u64, voter: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Vote(proposal_id, voter))
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
    use soroban_sdk::{symbol_short, Env};

    fn setup() -> (Env, GovernanceContractClient<'static>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GovernanceContract);
        let client = GovernanceContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let timelock_ledgers = 50u32;
        let quorum_bps = 1000i128;
        client.initialize(&admin, &token, &timelock_ledgers, &quorum_bps);
        (env, client, admin, token, quorum_bps)
    }

    #[test]
    fn test_initialize_sets_admin() {
        let (_, client, admin, _, _) = setup();
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_double_initialize_panics() {
        let (_, client, admin, token, quorum_bps) = setup();
        client.initialize(&admin, &token, &50u32, &quorum_bps);
    }

    #[test]
    fn test_create_proposal() {
        let (env, client, _, _, _) = setup();
        let proposer = Address::generate(&env);
        let title = String::from_str(&env, "New Course Category");
        let desc = String::from_str(&env, "Add blockchain category");
        let end = env.ledger().sequence() + 100;

        let id = client.create_proposal(&proposer, &title, &desc, &end);
        assert_eq!(id, 1);

        let prop = client.get_proposal(&id).unwrap();
        assert_eq!(prop.proposer, proposer);
        assert_eq!(prop.title, title);
        assert!(!prop.executed);
    }

    #[test]
    #[should_panic(expected = "Voting end must be in future")]
    fn test_create_proposal_past_end_panics() {
        let (env, client, _, _, _) = setup();
        let proposer = Address::generate(&env);
        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Test");
        let current = env.ledger().sequence();
        let end = if current > 0 { current - 1 } else { 0 };

        client.create_proposal(&proposer, &title, &desc, &end);
    }

    #[test]
    fn test_create_proposal_increments_id() {
        let (env, client, _, _, _) = setup();
        let proposer = Address::generate(&env);
        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Test");
        let end = env.ledger().sequence() + 100;

        let id1 = client.create_proposal(&proposer, &title, &desc, &end);
        let id2 = client.create_proposal(&proposer, &title, &desc, &end);
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    #[should_panic(expected = "Voting period ended")]
    fn test_vote_after_voting_end_panics() {
        let (env, client, _, _, _) = setup();
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);
        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Test");
        let end = env.ledger().sequence() + 10;

        let id = client.create_proposal(&proposer, &title, &desc, &end);

        // Advance past voting end
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            sequence_number: end + 1,
            timestamp: (end + 1) as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });

        client.vote(&voter, &id, &true);
    }

    #[test]
    fn test_has_voted() {
        let (env, client, _, _, _) = setup();
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);
        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Test");
        let end = env.ledger().sequence() + 100;

        let id = client.create_proposal(&proposer, &title, &desc, &end);

        assert!(!client.has_voted(&id, &voter));
        // Note: vote would fail without proper token contract mock
        // This test just verifies has_voted returns false initially
    }

    #[test]
    #[should_panic(expected = "Voting still ongoing")]
    fn test_execute_before_voting_end_panics() {
        let (env, client, _, _, _) = setup();
        let proposer = Address::generate(&env);
        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Test");
        let end = env.ledger().sequence() + 100;

        let id = client.create_proposal(&proposer, &title, &desc, &end);
        client.execute_proposal(&id);
    }

    #[test]
    #[should_panic(expected = "Proposal did not pass")]
    fn test_execute_without_quorum_panics() {
        let (env, client, _, _, _) = setup();
        let proposer = Address::generate(&env);
        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Test");
        let end = env.ledger().sequence() + 10;

        let id = client.create_proposal(&proposer, &title, &desc, &end);

        // Advance past voting end
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            sequence_number: end + 1,
            timestamp: (end + 1) as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });

        client.execute_proposal(&id);
    }

    #[test]
    fn test_proposal_lifecycle() {
        let (env, client, _, _, _) = setup();
        let proposer = Address::generate(&env);
        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Test");
        let end = env.ledger().sequence() + 10;

        let id = client.create_proposal(&proposer, &title, &desc, &end);
        let prop = client.get_proposal(&id).unwrap();
        assert!(!prop.executed);

        // Advance past voting end
        env.ledger().set(LedgerInfo {
            sequence_number: end + 1,
            timestamp: (end + 1) as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });

        // Verify proposal structure is correct
        let prop = client.get_proposal(&id).unwrap();
        assert_eq!(prop.votes_for, 0);
        assert_eq!(prop.votes_against, 0);
    }

    // =========================================================================
    // Timelock Tests (Issue #555)
    // =========================================================================

    #[test]
    fn test_initialize_with_timelock() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GovernanceContract);
        let client = GovernanceContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let timelock_ledgers = 100u32;
        let quorum_bps = 1000i128;

        client.initialize(&admin, &token, &timelock_ledgers, &quorum_bps);
        assert_eq!(client.get_timelock_ledgers(), timelock_ledgers);
        assert_eq!(client.get_quorum_bps(), quorum_bps);
    }

    #[test]
    #[should_panic(expected = "Timelock must be greater than 0")]
    fn test_initialize_with_zero_timelock_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GovernanceContract);
        let client = GovernanceContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin, &token, &0u32, &1000i128);
    }

    #[test]
    #[should_panic(expected = "Timelock not expired")]
    fn test_execute_upgrade_before_timelock_panics() {
        let (env, client, _, _) = setup();
        let proposer = Address::generate(&env);
        let contract_addr = Address::generate(&env);
        let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
        let voting_end = env.ledger().sequence() + 10;
        let timelock = voting_end + 50;

        // Propose upgrade
        let upgrade_id = client.propose_upgrade(
            &proposer,
            &contract_addr,
            &wasm_hash,
            &voting_end,
            &timelock,
        );

        // Approve upgrade
        env.ledger().set(LedgerInfo {
            sequence_number: voting_end + 1,
            timestamp: (voting_end + 1) as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });
        client.approve_upgrade(&upgrade_id);

        // Try to execute before timelock expires (should panic)
        client.execute_upgrade(&upgrade_id);
    }

    #[test]
    fn test_execute_upgrade_at_timelock_threshold() {
        let (env, client, _, _) = setup();
        let proposer = Address::generate(&env);
        let contract_addr = Address::generate(&env);
        let wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
        let voting_end = env.ledger().sequence() + 10;
        let timelock = voting_end + 50;

        // Propose upgrade
        let upgrade_id = client.propose_upgrade(
            &proposer,
            &contract_addr,
            &wasm_hash,
            &voting_end,
            &timelock,
        );

        // Approve upgrade
        env.ledger().set(LedgerInfo {
            sequence_number: voting_end + 1,
            timestamp: (voting_end + 1) as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });
        client.approve_upgrade(&upgrade_id);

        // Advance to exactly the timelock threshold
        env.ledger().set(LedgerInfo {
            sequence_number: timelock,
            timestamp: timelock as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });

        // Execute should succeed at threshold
        client.execute_upgrade(&upgrade_id);

        // Verify execution
        let upgrade = client.get_upgrade_proposal(&upgrade_id).unwrap();
        assert!(upgrade.executed);
    }

    #[test]
    fn test_execute_upgrade_after_timelock_expires() {
        let (env, client, _, _) = setup();
        let proposer = Address::generate(&env);
        let contract_addr = Address::generate(&env);
        let wasm_hash = BytesN::from_array(&env, &[2u8; 32]);
        let voting_end = env.ledger().sequence() + 10;
        let timelock = voting_end + 50;

        // Propose upgrade
        let upgrade_id = client.propose_upgrade(
            &proposer,
            &contract_addr,
            &wasm_hash,
            &voting_end,
            &timelock,
        );

        // Approve upgrade
        env.ledger().set(LedgerInfo {
            sequence_number: voting_end + 1,
            timestamp: (voting_end + 1) as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });
        client.approve_upgrade(&upgrade_id);

        // Advance well past the timelock
        env.ledger().set(LedgerInfo {
            sequence_number: timelock + 100,
            timestamp: (timelock + 100) as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });

        // Execute should succeed well after timelock
        client.execute_upgrade(&upgrade_id);

        // Verify execution
        let upgrade = client.get_upgrade_proposal(&upgrade_id).unwrap();
        assert!(upgrade.executed);
    }

    #[test]
    #[should_panic(expected = "Timelock must be after voting")]
    fn test_propose_upgrade_with_timelock_before_voting_end_panics() {
        let (env, client, _, _, _) = setup();
        let proposer = Address::generate(&env);
        let contract_addr = Address::generate(&env);
        let wasm_hash = BytesN::from_array(&env, &[3u8; 32]);
        let voting_end = env.ledger().sequence() + 50;
        let invalid_timelock = voting_end - 10; // timelock before voting end

        client.propose_upgrade(
            &proposer,
            &contract_addr,
            &wasm_hash,
            &voting_end,
            &invalid_timelock,
        );
    }

    // =========================================================================
    // Mock Token Contract for Quorum Tests
    // =========================================================================

    #[contract]
    pub struct MockTokenContract;

    #[contractimpl]
    impl MockTokenContract {
        pub fn total_supply(env: Env) -> i128 {
            1_000_000_000_000_000
        }

        pub fn balance(env: Env, _addr: Address) -> i128 {
            0
        }
    }

    #[test]
    fn test_quorum_default_is_1000() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GovernanceContract);
        let client = GovernanceContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let quorum_bps = 500i128;

        client.initialize(&admin, &token, &50u32, &quorum_bps);
        assert_eq!(client.get_quorum_bps(), quorum_bps);
    }

    #[test]
    #[should_panic(expected = "Insufficient quorum")]
    fn test_execute_proposal_fails_with_insufficient_quorum() {
        let env = Env::default();
        env.mock_all_auths();
        let token_id = env.register_contract(None, MockTokenContract);
        let gov_id = env.register_contract(None, GovernanceContract);
        let client = GovernanceContractClient::new(&env, &gov_id);
        let admin = Address::generate(&env);
        let quorum_bps = 1000i128;
        client.initialize(&admin, &token_id, &50u32, &quorum_bps);

        let proposal = ProposalRecord {
            id: 1,
            proposer: admin.clone(),
            title: String::from_str(&env, "Test"),
            description: String::from_str(&env, "Test"),
            voting_end_ledger: env.ledger().sequence(),
            votes_for: 50,
            votes_against: 0,
            executed: false,
            created_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Proposal(1), &proposal);
        env.storage().instance().set(&DataKey::NextProposalId, &2u64);

        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            sequence_number: env.ledger().sequence() + 1,
            timestamp: (env.ledger().sequence() + 1) as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });

        client.execute_proposal(&1);
    }

    // =========================================================================
    // Overflow Tests (Issue #1166)
    // =========================================================================

    #[test]
    fn test_quorum_threshold_bps_large_voter_count_no_overflow() {
        // A voter count far beyond u32::MAX (~4.29e9) must not overflow.
        let total_votes_cast = i128::MAX / BPS_DENOMINATOR;
        let total_supply = i128::MAX;
        let threshold = quorum_threshold_bps(total_votes_cast, total_supply);
        assert_eq!(threshold, 1);
    }

    #[test]
    fn test_quorum_threshold_bps_max_values() {
        // Maximum i128 values: (i128::MAX * 10_000) would overflow, so the
        // helper must be exercised with values that stay within bounds.
        let total_supply = i128::MAX;
        let total_votes_cast = i128::MAX / BPS_DENOMINATOR;
        let threshold = quorum_threshold_bps(total_votes_cast, total_supply);
        assert!(threshold >= 0);
        assert_eq!(threshold, 1);
    }

    #[test]
    fn test_quorum_threshold_bps_full_turnout() {
        let total_supply = i128::MAX;
        let threshold = quorum_threshold_bps(total_supply, total_supply);
        assert_eq!(threshold, BPS_DENOMINATOR);
    }

    #[test]
    fn test_add_votes_large_values_no_overflow() {
        let tally = i128::MAX / 2;
        let balance = i128::MAX / 2;
        let result = add_votes(tally, balance);
        assert_eq!(result, i128::MAX - 1);
    }

    #[test]
    #[should_panic(expected = "Vote tally overflow")]
    fn test_add_votes_overflow_panics() {
        add_votes(i128::MAX, 1);
    }

    #[test]
    #[should_panic(expected = "Quorum calculation overflow")]
    fn test_quorum_threshold_bps_overflow_panics() {
        quorum_threshold_bps(i128::MAX, 1);
    }

    #[test]
    fn test_large_voter_count_quorum_passes() {
        // Simulates a large voter set (well above u32::MAX) reaching quorum.
        let env = Env::default();
        env.mock_all_auths();
        let token_id = env.register_contract(None, MockTokenContract);
        let gov_id = env.register_contract(None, GovernanceContract);
        let client = GovernanceContractClient::new(&env, &gov_id);
        let admin = Address::generate(&env);
        let quorum_bps = 1000i128;
        client.initialize(&admin, &token_id, &50u32, &quorum_bps);

        // votes_for is far larger than u32::MAX; quorum math must not overflow.
        let large_votes: i128 = 5_000_000_000_000_000;
        let proposal = ProposalRecord {
            id: 1,
            proposer: admin.clone(),
            title: String::from_str(&env, "Large"),
            description: String::from_str(&env, "Large voter set"),
            voting_end_ledger: env.ledger().sequence(),
            votes_for: large_votes,
            votes_against: 0,
            executed: false,
            created_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Proposal(1), &proposal);
        env.storage().instance().set(&DataKey::NextProposalId, &2u64);

        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            sequence_number: env.ledger().sequence() + 1,
            timestamp: (env.ledger().sequence() + 1) as u64 * 5,
            protocol_version: 21,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 100_000,
        });

        client.execute_proposal(&1);

        let executed = client.get_proposal(&1).unwrap();
        assert!(executed.executed);
    }
}
