#![cfg(test)]
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};

use crate::{AnalyticsContract, AnalyticsContractClient, DataKey};

#[cfg(test)]
mod fuzz_tests {
    use proptest::prelude::*;
    use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};
    use crate::{AnalyticsContract, AnalyticsContractClient};

    fn setup() -> (Env, AnalyticsContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AnalyticsContract);
        let client = AnalyticsContractClient::new(&env, &contract_id);
        (env, client)
    }

    proptest! {
        #[test]
        fn fuzz_record_progress_valid_range(progress_pct in 0u32..=100u32) {
            let (env, client) = setup();
            let student = Address::generate(&env);
            let course = symbol_short!("TEST");
            
            client.record_progress(&student, &course, &progress_pct);
            let rec = client.get_progress(&student, &course).unwrap();
            prop_assert_eq!(rec.progress_pct, progress_pct);
        }

        #[test]
        fn fuzz_record_progress_invalid_range(progress_pct in 101u32..=u32::MAX) {
            let (env, client) = setup();
            let student = Address::generate(&env);
            let course = symbol_short!("TEST");
            
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.record_progress(&student, &course, &progress_pct);
            }));
            prop_assert!(result.is_err());
        }
    }
}

fn setup() -> (Env, AnalyticsContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AnalyticsContract);
    let client = AnalyticsContractClient::new(&env, &contract_id);
    (env, client)
}

#[test]
fn test_record_and_get_progress() {
    let (env, client) = setup();
    let student = Address::generate(&env);
    let course = symbol_short!("RUST101");
    client.record_progress(&student, &course, &75);
    let rec = client.get_progress(&student, &course).unwrap();
    assert_eq!(rec.progress_pct, 75);
    assert!(!rec.completed);
}

#[test]
fn test_completed_flag_at_100() {
    let (env, client) = setup();
    let student = Address::generate(&env);
    let course = symbol_short!("RUST101");
    client.record_progress(&student, &course, &100);
    let rec = client.get_progress(&student, &course).unwrap();
    assert!(rec.completed);
}

#[test]
#[should_panic(expected = "Progress must be 0-100")]
fn test_invalid_progress_panics() {
    let (env, client) = setup();
    let student = Address::generate(&env);
    client.record_progress(&student, &symbol_short!("X"), &101);
}

#[test]
#[should_panic(expected = "reentrant call")]
fn test_reentrancy_guard_on_record_progress() {
    let (env, client) = setup();
    env.as_contract(&client.address, || {
        env.storage().instance().set(&DataKey::Locked, &true);
    });
    let student = Address::generate(&env);
    client.record_progress(&student, &symbol_short!("X"), &50);
}

#[test]
fn test_record_progress_upserts_single_entry() {
    let (env, client) = setup();
    let student = Address::generate(&env);
    let course = symbol_short!("RUST101");
    let key = DataKey::Progress(student.clone(), course.clone());

    // No entry before the first call.
    env.as_contract(&client.address, || {
        assert!(!env.storage().persistent().has(&key));
    });

    // Multiple calls for the same (student, course_id) pair.
    client.record_progress(&student, &course, &10);
    client.record_progress(&student, &course, &40);
    client.record_progress(&student, &course, &75);

    // get_progress returns the latest value.
    let rec = client.get_progress(&student, &course).unwrap();
    assert_eq!(rec.progress_pct, 75);
    assert!(!rec.completed);

    // Exactly one persistent entry exists for the key.
    env.as_contract(&client.address, || {
        assert!(env.storage().persistent().has(&key));
        let stored: crate::ProgressRecord = env.storage().persistent().get(&key).unwrap();
        assert_eq!(stored.progress_pct, 75);
    });
}

#[test]
fn test_record_progress_storage_entry_count_stable() {
    let (env, client) = setup();
    let student = Address::generate(&env);
    let course = symbol_short!("RUST101");
    let key = DataKey::Progress(student.clone(), course.clone());

    // Count persistent entries before any writes.
    let before = env.as_contract(&client.address, || {
        env.storage().persistent().keys().len()
    });

    // Repeated writes for the same key must not grow storage.
    for pct in [5u32, 25, 50, 75, 100] {
        client.record_progress(&student, &course, &pct);
    }

    let after = env.as_contract(&client.address, || {
        env.storage().persistent().keys().len()
    });

    assert_eq!(before, 0);
    assert_eq!(after, 1, "repeated record_progress calls must not grow storage");

    env.as_contract(&client.address, || {
        assert!(env.storage().persistent().has(&key));
    });

    let rec = client.get_progress(&student, &course).unwrap();
    assert_eq!(rec.progress_pct, 100);
    assert!(rec.completed);
}

#[test]
fn test_record_progress_distinct_keys_create_distinct_entries() {
    let (env, client) = setup();
    let student = Address::generate(&env);
    let course_a = symbol_short!("RUST101");
    let course_b = symbol_short!("GO101");

    client.record_progress(&student, &course_a, &30);
    client.record_progress(&student, &course_a, &60);
    client.record_progress(&student, &course_b, &20);

    let count = env.as_contract(&client.address, || {
        env.storage().persistent().keys().len()
    });
    assert_eq!(count, 2);

    assert_eq!(client.get_progress(&student, &course_a).unwrap().progress_pct, 60);
    assert_eq!(client.get_progress(&student, &course_b).unwrap().progress_pct, 20);
}
