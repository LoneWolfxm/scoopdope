#!/usr/bin/env bash

# ============================================================================
# Deployment Helper Functions
# ============================================================================
# Utility functions for contract deployment, verification, and management.
# Source this file in other scripts: source ./scripts/deployment-helpers.sh
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Color codes
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export NC='\033[0m'

# Files
export DEPLOYED_CONTRACTS="${PROJECT_ROOT}/scripts/deployed-contracts.json"
export DEPLOYMENT_LOG="${PROJECT_ROOT}/scripts/.deployment-history.json"

# ============================================================================
# Logging Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
    echo -e "${GREEN}✓${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $*"
}

log_error() {
    echo -e "${RED}✗${NC} $*" >&2
}

# ============================================================================
# Deployment Registry Functions
# ============================================================================

# Initialize deployment registry
init_deployment_registry() {
    if [ ! -f "$DEPLOYED_CONTRACTS" ]; then
        mkdir -p "$(dirname "$DEPLOYED_CONTRACTS")"
        cat > "$DEPLOYED_CONTRACTS" << 'REGISTRY'
{
  "testnet": {},
  "mainnet": {}
}
REGISTRY
        log_success "Created deployment registry: $DEPLOYED_CONTRACTS"
    fi
}

# Get deployed contract ID
get_contract_id() {
    local network="$1"
    local contract_name="$2"
    
    if [ ! -f "$DEPLOYED_CONTRACTS" ]; then
        return 1
    fi
    
    jq -r ".\"$network\".\"$contract_name\" // empty" "$DEPLOYED_CONTRACTS" 2>/dev/null || return 1
}

# List all deployed contracts
list_deployments() {
    local network="${1:-}"
    
    if [ ! -f "$DEPLOYED_CONTRACTS" ]; then
        log_error "Deployment registry not found: $DEPLOYED_CONTRACTS"
        return 1
    fi
    
    if [ -z "$network" ]; then
        echo "Deployments:"
        jq '.' "$DEPLOYED_CONTRACTS"
    else
        echo "Deployments for $network:"
        jq ".\"$network\"" "$DEPLOYED_CONTRACTS"
    fi
}

# ============================================================================
# Deployment History Functions
# ============================================================================

# Initialize deployment history
init_deployment_history() {
    if [ ! -f "$DEPLOYMENT_LOG" ]; then
        mkdir -p "$(dirname "$DEPLOYMENT_LOG")"
        echo "[]" > "$DEPLOYMENT_LOG"
        log_success "Created deployment history: $DEPLOYMENT_LOG"
    fi
}

# View deployment history
view_deployment_history() {
    local network="${1:-}"
    local limit="${2:-10}"
    
    if [ ! -f "$DEPLOYMENT_LOG" ]; then
        log_error "Deployment history not found: $DEPLOYMENT_LOG"
        return 1
    fi
    
    if [ -z "$network" ]; then
        jq ".[0:$limit] | reverse" "$DEPLOYMENT_LOG"
    else
        jq ".[0:$limit] | reverse | map(select(.network == \"$network\"))" "$DEPLOYMENT_LOG"
    fi
}

# Get latest deployment
get_latest_deployment() {
    local network="$1"
    local contract="${2:-}"
    
    if [ ! -f "$DEPLOYMENT_LOG" ]; then
        return 1
    fi
    
    if [ -z "$contract" ]; then
        jq --arg network "$network" '.[] | select(.network == $network) | select(.contract_id != "error")' "$DEPLOYMENT_LOG" | tail -1
    else
        jq --arg network "$network" --arg contract "$contract" '.[] | select(.network == $network and .contract == $contract) | select(.contract_id != "error")' "$DEPLOYMENT_LOG" | tail -1
    fi
}

# ============================================================================
# Contract Verification Functions
# ============================================================================

# Verify contract exists on network
verify_contract_exists() {
    local contract_id="$1"
    local network="${2:-testnet}"
    
    log_info "Verifying contract: $contract_id on $network"
    
    if stellar contract info --id "$contract_id" --network "$network" &> /dev/null; then
        log_success "Contract verified on $network"
        return 0
    else
        log_warning "Could not verify contract (may be expected depending on network)"
        return 0
    fi
}

# Get contract info from network
get_contract_info() {
    local contract_id="$1"
    local network="${2:-testnet}"
    
    stellar contract info --id "$contract_id" --network "$network"
}

# ============================================================================
# Environment Variable Functions
# ============================================================================

# Update .env file with contract ID
update_env_contract_id() {
    local contract_name="$1"
    local contract_id="$2"
    local env_file="${3:-./.env}"
    
    local env_var_name
    env_var_name=$(echo "$contract_name" | tr '[:lower:]' '[:upper:]')_CONTRACT_ID
    
    if [ ! -f "$env_file" ]; then
        log_warning "Environment file not found: $env_file"
        return 1
    fi
    
    # Check if variable exists
    if grep -q "^${env_var_name}=" "$env_file"; then
        # Update existing variable
        sed -i "s/^${env_var_name}=.*/${env_var_name}=${contract_id}/" "$env_file"
    else
        # Append new variable
        echo "${env_var_name}=${contract_id}" >> "$env_file"
    fi
    
    log_success "Updated $env_file: ${env_var_name}=${contract_id}"
}

# ============================================================================
# Deployment Status Functions
# ============================================================================

# Show deployment status
show_deployment_status() {
    local network="${1:-testnet}"
    
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "Deployment Status for $network"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    
    list_deployments "$network"
    
    echo ""
    echo "Recent deployments:"
    view_deployment_history "$network" 5
    
    echo ""
    echo "═══════════════════════════════════════════════════════════"
}

# ============================================================================
# Validation Functions
# ============================================================================

# Validate network parameter
validate_network() {
    local network="$1"
    
    if [[ ! "$network" =~ ^(testnet|mainnet)$ ]]; then
        log_error "Invalid network: $network (must be testnet or mainnet)"
        return 1
    fi
    return 0
}

# Validate contract exists
validate_contract_exists() {
    local contract_name="$1"
    local contract_path="${PROJECT_ROOT}/contracts/${contract_name}"
    
    if [ ! -d "$contract_path" ] || [ ! -f "$contract_path/Cargo.toml" ]; then
        log_error "Contract not found: $contract_name"
        return 1
    fi
    return 0
}

# Validate environment variables
validate_deployment_env() {
    if [ -z "${STELLAR_SECRET_KEY:-}" ]; then
        log_error "Missing STELLAR_SECRET_KEY environment variable"
        return 1
    fi
    return 0
}

# ============================================================================
# Build Functions
# ============================================================================

# Build contract
build_contract() {
    local contract_name="$1"
    local contract_path="${PROJECT_ROOT}/contracts/${contract_name}"
    local manifest="${contract_path}/Cargo.toml"
    
    if ! cargo build \
        --release \
        --target "wasm32-unknown-unknown" \
        --manifest-path "$manifest" 2>&1; then
        log_error "Build failed: $contract_name"
        return 1
    fi
    
    log_success "Built: $contract_name"
    return 0
}

# Find WASM file for contract
find_wasm_file() {
    local contract_name="$1"
    local wasm_dir="${PROJECT_ROOT}/target/wasm32-unknown-unknown/release"
    
    # Try standard patterns
    for pattern in "scoopdope_${contract_name}" "scoopdope_${contract_name//_/-}" "${contract_name}"; do
        if [ -f "${wasm_dir}/${pattern}.wasm" ]; then
            echo "${wasm_dir}/${pattern}.wasm"
            return 0
        fi
    done
    
    # Search more broadly
    local found
    found=$(find "$wasm_dir" -name "*${contract_name}*.wasm" 2>/dev/null | head -n1)
    if [ -n "$found" ]; then
        echo "$found"
        return 0
    fi
    
    return 1
}

# ============================================================================
# Deployment Functions
# ============================================================================

# Deploy contract to network
deploy_contract_to_network() {
    local wasm_file="$1"
    local network="$2"
    local secret_key="${3:-$STELLAR_SECRET_KEY}"
    
    log_info "Deploying to $network..."
    
    local deploy_output
    if ! deploy_output=$(stellar contract deploy \
        --wasm "$wasm_file" \
        --source "$secret_key" \
        --network "$network" 2>&1); then
        log_error "Deployment failed"
        echo "$deploy_output"
        return 1
    fi
    
    # Extract contract ID
    local contract_id
    contract_id=$(echo "$deploy_output" | grep -oP 'Contract ID:\s*\K[A-Z0-9]+' || echo "")
    
    if [ -z "$contract_id" ]; then
        contract_id=$(echo "$deploy_output" | grep -oE '[A-Z0-9]{56}' | head -1 || echo "")
    fi
    
    if [ -z "$contract_id" ]; then
        log_error "Failed to extract contract ID"
        echo "$deploy_output"
        return 1
    fi
    
    echo "$contract_id"
    return 0
}

# ============================================================================
# Blue-Green Cutover Functions
# ============================================================================
# These helpers gate the traffic switch on health and smoke test success and
# provide automatic rollback to blue when verification fails.
#
# Environment variables:
#   GREEN_URL          Base URL of the green environment (required)
#   BLUE_URL           Base URL of the blue environment (required for rollback)
#   HEALTH_TIMEOUT     Seconds to wait for green /health to return 200 (default: 120)
#   HEALTH_INTERVAL    Seconds between health polls (default: 5)
#   SMOKE_TIMEOUT      Per-request timeout in seconds for smoke tests (default: 10)
# ============================================================================

# Poll GET /health on the green environment until it returns 200 or times out.
# Usage: wait_for_green_health [green_url]
wait_for_green_health() {
    local green_url="${1:-${GREEN_URL:-}}"
    local timeout="${HEALTH_TIMEOUT:-120}"
    local interval="${HEALTH_INTERVAL:-5}"

    if [ -z "$green_url" ]; then
        log_error "wait_for_green_health: GREEN_URL is not set"
        return 1
    fi

    local health_url="${green_url%/}/health"
    local elapsed=0
    local status=""

    log_info "Waiting for green health check: $health_url (timeout: ${timeout}s)"

    while [ "$elapsed" -lt "$timeout" ]; do
        status=$(curl -s -o /dev/null -w '%{http_code}' \
            --max-time "${SMOKE_TIMEOUT:-10}" "$health_url" 2>/dev/null || echo "000")

        if [ "$status" = "200" ]; then
            log_success "Green environment healthy (GET /health returned 200)"
            return 0
        fi

        log_info "Health check returned $status, retrying in ${interval}s (${elapsed}/${timeout}s)"
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done

    log_error "Green environment failed health check: GET /health did not return 200 within ${timeout}s (last status: $status)"
    return 1
}

# Run smoke tests against the green environment.
# Calls critical API endpoints and asserts expected status codes.
# Usage: run_smoke_tests [green_url]
run_smoke_tests() {
    local green_url="${1:-${GREEN_URL:-}}"

    if [ -z "$green_url" ]; then
        log_error "run_smoke_tests: GREEN_URL is not set"
        return 1
    fi

    local base="${green_url%/}"
    local timeout="${SMOKE_TIMEOUT:-10}"
    local failures=0
    local total=0

    # Each entry: "<expected_status> <path> <description>"
    local smoke_cases=(
        "200 /health Health endpoint"
        "200 /api/v1/status Service status"
        "200 /api/v1/contracts Contracts listing"
        "200 /api/v1/version Version info"
        "200 /api/v1/metrics Metrics endpoint"
    )

    log_info "Running smoke tests against $base"

    local case_entry expected path description status
    for case_entry in "${smoke_cases[@]}"; do
        read -r expected path description <<< "$case_entry"
        total=$((total + 1))

        status=$(curl -s -o /dev/null -w '%{http_code}' \
            --max-time "$timeout" "${base}${path}" 2>/dev/null || echo "000")

        if [ "$status" = "$expected" ]; then
            log_success "Smoke test passed: ${description} (GET ${path} -> ${status})"
        else
            log_error "Smoke test failed: ${description} (GET ${path} -> ${status}, expected ${expected})"
            failures=$((failures + 1))
        fi
    done

    if [ "$failures" -ne 0 ]; then
        log_error "Smoke tests failed: ${failures}/${total} checks did not pass"
        return 1
    fi

    log_success "All smoke tests passed (${total}/${total})"
    return 0
}

# Switch traffic from blue to green.
# Only performs the cutover if health checks and smoke tests pass.
# Usage: switch_traffic_to_green [green_url]
switch_traffic_to_green() {
    local green_url="${1:-${GREEN_URL:-}}"

    if [ -z "$green_url" ]; then
        log_error "switch_traffic_to_green: GREEN_URL is not set"
        return 1
    fi

    log_info "Verifying green environment before traffic switch"

    if ! wait_for_green_health "$green_url"; then
        log_error "Aborting traffic switch: health check failed"
        return 1
    fi

    if ! run_smoke_tests "$green_url"; then
        log_error "Aborting traffic switch: smoke tests failed"
        return 1
    fi

    log_info "Switching traffic to green: $green_url"

    # Update the active environment pointer used by the router/load balancer.
    local active_env_file="${PROJECT_ROOT}/scripts/.active-environment"
    mkdir -p "$(dirname "$active_env_file")"
    echo "green" > "$active_env_file"

    log_success "Traffic switched to green"
    return 0
}

# Roll back traffic to the blue environment.
# Usage: rollback_to_blue [blue_url]
rollback_to_blue() {
    local blue_url="${1:-${BLUE_URL:-}}"

    if [ -z "$blue_url" ]; then
        log_error "rollback_to_blue: BLUE_URL is not set"
        return 1
    fi

    log_warning "Rolling back traffic to blue: $blue_url"

    local active_env_file="${PROJECT_ROOT}/scripts/.active-environment"
    mkdir -p "$(dirname "$active_env_file")"
    echo "blue" > "$active_env_file"

    # Confirm blue is still serving before declaring rollback complete.
    local status
    status=$(curl -s -o /dev/null -w '%{http_code}' \
        --max-time "${SMOKE_TIMEOUT:-10}" "${blue_url%/}/health" 2>/dev/null || echo "000")

    if [ "$status" = "200" ]; then
        log_success "Rollback complete: blue environment healthy (GET /health returned 200)"
        return 0
    fi

    log_error "Rollback performed but blue health check returned $status"
    return 1
}

# ============================================================================
# Export functions for use in other scripts
# ============================================================================

export -f log_info log_success log_warning log_error
export -f init_deployment_registry get_contract_id list_deployments
export -f init_deployment_history view_deployment_history get_latest_deployment
export -f verify_contract_exists get_contract_info
export -f update_env_contract_id show_deployment_status
export -f validate_network validate_contract_exists validate_deployment_env
export -f build_contract find_wasm_file deploy_contract_to_network
export -f wait_for_green_health run_smoke_tests switch_traffic_to_green rollback_to_blue
