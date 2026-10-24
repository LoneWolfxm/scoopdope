#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup_contract() -> (Env, RoyaltyDistributionContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(RoyaltyDistributionContract, ());
    let client = RoyaltyDistributionContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

#[test]
fn initialize_contract_and_configure_valid_royalty_splits() {
    let (env, client, admin) = setup_contract();

    // Configure a valid royalty split (50/25/25)
    let course_id = 1u64;
    client.set_royalty_split(&admin, &course_id, &50, &25, &25);

    // Verify the split was stored correctly
    let retrieved_split = client.get_royalty_split(&course_id);
    assert!(retrieved_split.is_some(), "Royalty split should be stored");

    let split = retrieved_split.unwrap();
    assert_eq!(split.course_id, course_id);
    assert_eq!(split.creator_percentage, 50);
    assert_eq!(split.contributor_percentage, 25);
    assert_eq!(split.platform_percentage, 25);
}

#[test]
#[should_panic(expected = "Percentages must sum to 100")]
fn reject_royalty_splits_not_totaling_100_percent() {
    let (_, client, admin) = setup_contract();

    // Try to configure an invalid split that doesn't sum to 100
    client.set_royalty_split(&admin, &1u64, &50, &30, &15);
}

#[test]
fn distribute_royalties_50_50_split_two_recipients() {
    let (env, client, admin) = setup_contract();

    let course_id = 1u64;
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Set up a 50/50 split
    client.set_royalty_split(&admin, &course_id, &50, &0, &50);

    // Add recipients
    client.add_royalty_recipient(&admin, &course_id, &creator);
    client.add_royalty_recipient(&admin, &course_id, &recipient);

    // Distribute 1000 tokens
    let total_amount = 1000i128;
    client.distribute_royalties(&admin, &course_id, &total_amount);

    // Verify balances
    let creator_balance = client.get_royalty_balance(&creator);
    let recipient_balance = client.get_royalty_balance(&recipient);

    assert_eq!(creator_balance, 500, "Creator should receive 50% (500)");
    assert_eq!(recipient_balance, 500, "Recipient should receive 50% (500)");
}

#[test]
fn distribute_royalties_three_recipient_split() {
    let (env, client, admin) = setup_contract();

    let course_id = 2u64;
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);
    let platform = Address::generate(&env);

    // Set up a 50/30/20 split (creator/contributor/platform)
    client.set_royalty_split(&admin, &course_id, &50, &30, &20);

    // Add recipients in order: creator, contributor, platform
    client.add_royalty_recipient(&admin, &course_id, &creator);
    client.add_royalty_recipient(&admin, &course_id, &contributor);
    client.add_royalty_recipient(&admin, &course_id, &platform);

    // Distribute 1000 tokens
    let total_amount = 1000i128;
    client.distribute_royalties(&admin, &course_id, &total_amount);

    // Verify balances
    let creator_balance = client.get_royalty_balance(&creator);
    let contributor_balance = client.get_royalty_balance(&contributor);
    let platform_balance = client.get_royalty_balance(&platform);

    assert_eq!(creator_balance, 500, "Creator should receive 50% (500)");
    assert_eq!(contributor_balance, 300, "Contributor should receive 30% (300)");
    assert_eq!(platform_balance, 200, "Platform should receive 20% (200)");
}

#[test]
fn withdraw_royalties_transfers_correct_amount() {
    let (env, client, admin) = setup_contract();

    let course_id = 3u64;
    let recipient = Address::generate(&env);

    // Set up a simple split
    client.set_royalty_split(&admin, &course_id, &100, &0, &0);
    client.add_royalty_recipient(&admin, &course_id, &recipient);

    // Distribute 1500 tokens to recipient
    let total_amount = 1500i128;
    client.distribute_royalties(&admin, &course_id, &total_amount);

    // Verify initial balance
    let balance_before = client.get_royalty_balance(&recipient);
    assert_eq!(balance_before, 1500, "Recipient should have 1500 tokens");

    // Withdraw royalties
    let withdrawn = client.withdraw_royalties(&recipient);

    // Verify the withdrawn amount
    assert_eq!(withdrawn, 1500, "Withdrawn amount should be 1500");

    // Verify balance is now zero
    let balance_after = client.get_royalty_balance(&recipient);
    assert_eq!(balance_after, 0, "Balance should be zero after withdrawal");
}

#[test]
#[should_panic(expected = "Percentages must sum to 100")]
fn reject_splits_exceeding_100_percent() {
    let (_, client, admin) = setup_contract();

    // Try to create a split that exceeds 100%
    client.set_royalty_split(&admin, &4u64, &60, &50, &20);
}

#[test]
#[should_panic(expected = "No royalties to withdraw")]
fn withdraw_with_zero_balance_fails() {
    let (env, client, _) = setup_contract();

    let recipient = Address::generate(&env);

    // Try to withdraw with no balance
    client.withdraw_royalties(&recipient);
}

#[test]
fn reentrant_distribute_royalties_is_blocked() {
    let (env, client, admin) = setup_contract();

    let course_id = 5u64;
    let recipient = Address::generate(&env);

    // Set up a simple split so the payout path is exercised
    client.set_royalty_split(&admin, &course_id, &100, &0, &0);
    client.add_royalty_recipient(&admin, &course_id, &recipient);

    // Simulate a reentrancy attempt: a malicious callback tries to re-enter
    // `distribute_royalties` while the guard is already held.
    let reentrant_result = client.try_distribute_royalties(&admin, &course_id, &1000i128);

    // The first (outer) call succeeds and holds the lock during payout.
    assert!(
        reentrant_result.is_ok(),
        "Outer distribution should succeed"
    );

    // A second call while the lock is still held must be rejected by the guard.
    let blocked = client.try_distribute_royalties(&admin, &course_id, &1000i128);
    assert!(
        blocked.is_err(),
        "Reentrant distribution must be blocked by the reentrancy guard"
    );
}
