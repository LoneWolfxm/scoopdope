use soroban_sdk::{contracttype, Address, Env, String, Symbol, symbol_short, Vec};

#[contracttype]
#[derive(Clone)]
pub struct VotingProposal {
    pub id: u64,
    pub title: String,
    pub description: String,
    pub voting_start_ledger: u32,
    pub voting_end_ledger: u32,
    pub votes_for: i128,
    pub votes_against: i128,
    pub total_votes: i128,
    pub quorum_required: i128,
    pub executed: bool,
}

#[contracttype]
pub enum GovernanceKey {
    Proposal(u64),
    Vote(u64, Address),
    Delegate(Address),
    NextProposalId,
    TotalSupply,
    QuorumPercentage,
}

pub const PROPOSAL_CREATED: Symbol = symbol_short!("gov_prop");
pub const VOTE_CAST: Symbol = symbol_short!("gov_vote");
pub const VOTE_DELEGATED: Symbol = symbol_short!("gov_del");
pub const PROPOSAL_EXECUTED: Symbol = symbol_short!("gov_exec");

pub fn create_proposal(
    env: &Env,
    proposer: Address,
    title: String,
    description: String,
    voting_end_ledger: u32,
) -> u64 {
    proposer.require_auth();

    let total_supply: i128 = env
        .storage()
        .instance()
        .get(&GovernanceKey::TotalSupply)
        .unwrap_or(1_000_000_000_000_000);

    let quorum_percentage: i128 = env
        .storage()
        .instance()
        .get(&GovernanceKey::QuorumPercentage)
        .unwrap_or(20); // 20% default

    let quorum_required = total_supply
        .checked_mul(quorum_percentage)
        .and_then(|product| product.checked_div(100))
        .expect("Quorum calculation overflow");

    let id: u64 = env
        .storage()
        .instance()
        .get(&GovernanceKey::NextProposalId)
        .unwrap_or(1);

    let proposal = VotingProposal {
        id,
        title,
        description,
        voting_start_ledger: env.ledger().sequence(),
        voting_end_ledger,
        votes_for: 0,
        votes_against: 0,
        total_votes: 0,
        quorum_required,
        executed: false,
    };

    env.storage()
        .instance()
        .set(&GovernanceKey::Proposal(id), &proposal);
    env.storage()
        .instance()
        .set(&GovernanceKey::NextProposalId, &(id + 1));

    env.events()
        .publish((PROPOSAL_CREATED,), (id, proposer, quorum_required));

    id
}

pub fn cast_vote(
    env: &Env,
    proposal_id: u64,
    voter: Address,
    support: bool,
    weight: i128,
) {
    voter.require_auth();

    let mut proposal: VotingProposal = env
        .storage()
        .instance()
        .get(&GovernanceKey::Proposal(proposal_id))
        .expect("Proposal not found");

    assert!(
        env.ledger().sequence() < proposal.voting_end_ledger,
        "Voting period ended"
    );

    let already_voted: Option<bool> = env
        .storage()
        .instance()
        .get(&GovernanceKey::Vote(proposal_id, voter.clone()));

    assert!(already_voted.is_none(), "Already voted");

    assert!(weight >= 0, "Vote weight must be non-negative");

    if support {
        proposal.votes_for = proposal
            .votes_for
            .checked_add(weight)
            .expect("votes_for overflow");
    } else {
        proposal.votes_against = proposal
            .votes_against
            .checked_add(weight)
            .expect("votes_against overflow");
    }
    proposal.total_votes = proposal
        .total_votes
        .checked_add(weight)
        .expect("total_votes overflow");

    env.storage()
        .instance()
        .set(&GovernanceKey::Vote(proposal_id, voter.clone()), &support);
    env.storage()
        .instance()
        .set(&GovernanceKey::Proposal(proposal_id), &proposal);

    env.events()
        .publish((VOTE_CAST,), (proposal_id, voter, support, weight));
}

pub fn delegate_vote(env: &Env, delegator: Address, delegate: Address) {
    delegator.require_auth();

    env.storage()
        .instance()
        .set(&GovernanceKey::Delegate(delegator.clone()), &delegate);

    env.events()
        .publish((VOTE_DELEGATED,), (delegator, delegate));
}

pub fn execute_proposal(env: &Env, proposal_id: u64) -> bool {
    let mut proposal: VotingProposal = env
        .storage()
        .instance()
        .get(&GovernanceKey::Proposal(proposal_id))
        .expect("Proposal not found");

    assert!(!proposal.executed, "Already executed");
    assert!(
        env.ledger().sequence() >= proposal.voting_end_ledger,
        "Voting still ongoing"
    );

    let quorum_met = proposal.total_votes >= proposal.quorum_required;
    let passed = proposal.votes_for > proposal.votes_against;

    if quorum_met && passed {
        proposal.executed = true;
        env.storage()
            .instance()
            .set(&GovernanceKey::Proposal(proposal_id), &proposal);

        env.events()
            .publish((PROPOSAL_EXECUTED,), (proposal_id, true));
        return true;
    }

    env.events()
        .publish((PROPOSAL_EXECUTED,), (proposal_id, false));
    false
}

pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<VotingProposal> {
    env.storage()
        .instance()
        .get(&GovernanceKey::Proposal(proposal_id))
}

pub fn get_delegate(env: &Env, delegator: Address) -> Option<Address> {
    env.storage()
        .instance()
        .get(&GovernanceKey::Delegate(delegator))
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup(env: &Env, supply: i128, quorum_percentage: i128) -> Address {
        let proposer = Address::generate(env);
        env.storage()
            .instance()
            .set(&GovernanceKey::TotalSupply, &supply);
        env.storage()
            .instance()
            .set(&GovernanceKey::QuorumPercentage, &quorum_percentage);
        proposer
    }

    #[test]
    fn test_quorum_with_max_i128_supply() {
        let env = Env::default();
        env.mock_all_auths();
        let proposer = setup(&env, i128::MAX, 100);

        let id = create_proposal(
            &env,
            proposer,
            String::from_str(&env, "t"),
            String::from_str(&env, "d"),
            env.ledger().sequence() + 10,
        );

        let proposal = get_proposal(&env, id).unwrap();
        assert_eq!(proposal.quorum_required, i128::MAX);
    }

    #[test]
    fn test_quorum_large_supply_no_overflow() {
        let env = Env::default();
        env.mock_all_auths();
        // 50 million voters * 100 tokens each = 5e9, well above u32 range
        let supply: i128 = 5_000_000_000;
        let proposer = setup(&env, supply, 20);

        let id = create_proposal(
            &env,
            proposer,
            String::from_str(&env, "t"),
            String::from_str(&env, "d"),
            env.ledger().sequence() + 10,
        );

        let proposal = get_proposal(&env, id).unwrap();
        assert_eq!(proposal.quorum_required, 1_000_000_000);
    }

    #[test]
    fn test_vote_tally_with_max_i128_weight() {
        let env = Env::default();
        env.mock_all_auths();
        let proposer = setup(&env, i128::MAX, 20);

        let id = create_proposal(
            &env,
            proposer,
            String::from_str(&env, "t"),
            String::from_str(&env, "d"),
            env.ledger().sequence() + 10,
        );

        let voter = Address::generate(&env);
        cast_vote(&env, id, voter, true, i128::MAX);

        let proposal = get_proposal(&env, id).unwrap();
        assert_eq!(proposal.votes_for, i128::MAX);
        assert_eq!(proposal.total_votes, i128::MAX);
    }

    #[test]
    #[should_panic(expected = "total_votes overflow")]
    fn test_vote_tally_overflow_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let proposer = setup(&env, i128::MAX, 20);

        let id = create_proposal(
            &env,
            proposer,
            String::from_str(&env, "t"),
            String::from_str(&env, "d"),
            env.ledger().sequence() + 10,
        );

        let voter_a = Address::generate(&env);
        cast_vote(&env, id, voter_a, true, i128::MAX);

        let voter_b = Address::generate(&env);
        cast_vote(&env, id, voter_b, true, 1);
    }

    #[test]
    #[should_panic(expected = "Quorum calculation overflow")]
    fn test_quorum_overflow_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let proposer = setup(&env, i128::MAX, 200);

        create_proposal(
            &env,
            proposer,
            String::from_str(&env, "t"),
            String::from_str(&env, "d"),
            env.ledger().sequence() + 10,
        );
    }
}
