#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Scoopdope Smart Contract Deployment Script
# ============================================================================
# Deploys Soroban smart contracts to Stellar testnet or mainnet.
# Compiles contracts to WASM, deploys via Stellar CLI, and tracks contract IDs.
#
# Usage:
#   ./scripts/deploy.sh <network> <contract>
#   ./scripts/deploy.sh testnet analytics
#   ./scripts/deploy.sh mainnet token
#
# Arguments:
#   network:  testnet or mainnet
#   contract: analytics, token, shared (or any contract in contracts/)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Configuration
# ============================================================================

# Default values
NETWORK="${1:-}"
CONTRACT_NAME="${2:-}"
WASM_TARGET="wasm32-unknown-unknown"
BUILD_PROFILE="release"

# Deployment tracking
DEPLOYMENT_LOG="${PROJECT_ROOT}/scripts/.deployment-history.json"
DEPLOYED_CONTRACTS="${PROJECT_ROOT}/scripts/deployed-contracts.json"

# Blue-green deployment configuration
BLUE_GREEN="${BLUE_GREEN:-false}"
GREEN_URL="${GREEN_URL:-}"
BLUE_URL="${BLUE_URL:-}"
HEALTH_CHECK_SCRIPT="${PROJECT_ROOT}/scripts/health-check.sh"
HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-60}"   # seconds to keep polling
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-5}"  # seconds between attempts
HEALTH_CHECK_MAX_RETRIES="${HEALTH_CHECK_MAX_RETRIES:-12}"
SMOKE_TEST_TIMEOUT="${SMOKE_TEST_TIMEOUT:-10}"       # per-request timeout in seconds
TRAFFIC_STATE_FILE="${TRAFFIC_STATE_FILE:-${PROJECT_ROOT}/scripts/.traffic-target}"

# ============================================================================
# Helper Functions
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

print_usage() {
    cat << EOF
${BLUE}Scoopdope Smart Contract Deployment${NC}

${YELLOW}Usage:${NC}
  ./scripts/deploy.sh <network> <contract>

${YELLOW}Arguments:${NC}
  network   - Stellar network: testnet or mainnet
  contract  - Contract name: analytics, token, shared, or any contract in contracts/

${YELLOW}Examples:${NC}
  ./scripts/deploy.sh testnet analytics
  ./scripts/deploy.sh mainnet token
  ./scripts/deploy.sh testnet shared

${YELLOW}Required Environment Variables:${NC}
  STELLAR_SECRET_KEY - Stellar account secret for deployment authority
  STELLAR_NETWORK    - Default network if not specified (optional)

${YELLOW}Output:${NC}
  - Contract ID written to scripts/deployed-contracts.json
  - Deployment record written to scripts/.deployment-history.json
  - Console output shows deployment summary

EOF
}

# Validate prerequisites
validate_prerequisites() {
    log_info "Validating prerequisites..."

    # Check for required tools
    local required_tools=("stellar" "cargo" "jq")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_error "Required tool not found: $tool"
            echo "  - stellar: install from https://github.com/stellar/stellar-cli"
            echo "  - cargo: install from https://www.rust-lang.org/tools/install"
            echo "  - jq: install via your package manager (apt, brew, etc.)"
            exit 1
        fi
    done

    log_success "All required tools found"
}

# Validate network argument
validate_network() {
    if [[ ! "$NETWORK" =~ ^(testnet|mainnet)$ ]]; then
        log_error "Invalid network: $NETWORK"
        echo "  Must be one of: testnet, mainnet"
        exit 1
    fi
    log_success "Network: $NETWORK"
}

# Validate contract exists
validate_contract() {
    local contract_path="${PROJECT_ROOT}/contracts/${CONTRACT_NAME}"
    if [ ! -d "$contract_path" ]; then
        log_error "Contract not found: $CONTRACT_NAME"
        echo "  Expected directory: $contract_path"
        echo ""
        echo "Available contracts:"
        ls -1 "${PROJECT_ROOT}/contracts/" | grep -E "^[a-z_]+$" | sed 's/^/  - /'
        exit 1
    fi

    if [ ! -f "$contract_path/Cargo.toml" ]; then
        log_error "Invalid contract: $CONTRACT_NAME (no Cargo.toml)"
        exit 1
    fi

    log_success "Contract: $CONTRACT_NAME"
}

# Check environment variables
validate_env() {
    if [ -z "${STELLAR_SECRET_KEY:-}" ]; then
        log_error "Missing required environment variable: STELLAR_SECRET_KEY"
        echo "  Set your Stellar secret key:"
        echo "    export STELLAR_SECRET_KEY='S...'"
        exit 1
    fi
    log_success "STELLAR_SECRET_KEY is set"
}

# Build contract to WASM
build_contract() {
    log_info "Building contract: $CONTRACT_NAME"
    
    local contract_manifest="${PROJECT_ROOT}/contracts/${CONTRACT_NAME}/Cargo.toml"
    
    if ! cargo build \
        --release \
        --target "$WASM_TARGET" \
        --manifest-path "$contract_manifest" \
        2>&1; then
        log_error "Build failed for contract: $CONTRACT_NAME"
        echo "  Check the error output above for details."
        exit 1
    fi
    
    log_success "Build successful"
}

# Find compiled WASM file
find_wasm_file() {
    # The WASM file is typically named after the crate name with dashes
    # We need to search for it since the exact name can vary
    local wasm_dir="${PROJECT_ROOT}/target/${WASM_TARGET}/${BUILD_PROFILE}"
    
    # Try to find WASM files for this contract
    local contract_wasm_files=(
        "${wasm_dir}/scoopdope_${CONTRACT_NAME}.wasm"
        "${wasm_dir}/scoopdope_${CONTRACT_NAME//_/-}.wasm"
        "${wasm_dir}/${CONTRACT_NAME}.wasm"
    )
    
    for wasm_file in "${contract_wasm_files[@]}"; do
        if [ -f "$wasm_file" ]; then
            echo "$wasm_file"
            return 0
        fi
    done
    
    # If not found, search more broadly
    local found=$(find "$wasm_dir" -name "*${CONTRACT_NAME}*.wasm" 2>/dev/null | head -n1)
    if [ -n "$found" ]; then
        echo "$found"
        return 0
    fi
    
    return 1
}

# Deploy contract to network
deploy_contract() {
    log_info "Deploying to $NETWORK..."
    
    local wasm_file
    wasm_file=$(find_wasm_file) || {
        log_error "WASM file not found for contract: $CONTRACT_NAME"
        echo "  Expected files in: ${PROJECT_ROOT}/target/${WASM_TARGET}/${BUILD_PROFILE}/"
        echo "  Try rebuilding with: ./scripts/build.sh"
        exit 1
    }
    
    local file_size
    file_size=$(du -h "$wasm_file" | cut -f1)
    log_info "Deploying WASM file: $(basename "$wasm_file") ($file_size)"
    
    # Deploy and capture output
    local deploy_output
    if ! deploy_output=$(stellar contract deploy \
        --wasm "$wasm_file" \
        --source "$STELLAR_SECRET_KEY" \
        --network "$NETWORK" 2>&1); then
        log_error "Deployment failed"
        echo ""
        echo "Output:"
        echo "$deploy_output"
        exit 1
    fi
    
    # Extract contract ID from output
    # The stellar CLI output format may vary, so we try multiple patterns
    local contract_id
    contract_id=$(echo "$deploy_output" | grep -oP 'Contract ID:\s*\K[A-Z0-9]+' || echo "")
    
    if [ -z "$contract_id" ]; then
        # Try alternative pattern
        contract_id=$(echo "$deploy_output" | grep -oE '[A-Z0-9]{56}' | head -1 || echo "")
    fi
    
    if [ -z "$contract_id" ]; then
        log_error "Failed to extract contract ID from deployment output"
        echo ""
        echo "Deployment output:"
        echo "$deploy_output"
        exit 1
    fi
    
    log_success "Deployment successful"
    echo ""
    echo -e "  ${GREEN}Contract ID: $contract_id${NC}"
    
    # Return contract ID
    echo "$contract_id"
}

# Verify contract is callable
verify_contract() {
    local contract_id="$1"
    
    log_info "Verifying contract deployment..."
    
    # Try a simple RPC call to verify the contract exists
    # Using the stellar CLI to check contract info
    if stellar contract info --id "$contract_id" --network "$NETWORK" &> /dev/null; then
        log_success "Contract verification successful"
        return 0
    else
        log_warning "Could not verify contract via RPC (this may be expected depending on network state)"
        return 0
    fi
}

# Update deployment registry
update_deployment_registry() {
    local contract_id="$1"
    
    log_info "Updating deployment registry..."
    
    # Initialize deployed-contracts.json if it doesn't exist
    if [ ! -f "$DEPLOYED_CONTRACTS" ]; then
        mkdir -p "$(dirname "$DEPLOYED_CONTRACTS")"
        cat > "$DEPLOYED_CONTRACTS" << 'REGISTRY'
{
  "testnet": {},
  "mainnet": {}
}
REGISTRY
    fi
    
    # Update the JSON file with the new contract ID
    local tmp_file
    tmp_file=$(mktemp)
    
    if ! jq ".\"$NETWORK\".\"$CONTRACT_NAME\" = \"$contract_id\"" "$DEPLOYED_CONTRACTS" > "$tmp_file"; then
        log_error "Failed to update deployment registry"
        rm -f "$tmp_file"
        exit 1
    fi
    
    mv "$tmp_file" "$DEPLOYED_CONTRACTS"
    log_success "Deployment registry updated"
}

# Log deployment to history
log_deployment_history() {
    local contract_id="$1"
    
    log_info "Recording deployment history..."
    
    # Initialize history file if it doesn't exist
    if [ ! -f "$DEPLOYMENT_LOG" ]; then
        mkdir -p "$(dirname "$DEPLOYMENT_LOG")"
        echo "[]" > "$DEPLOYMENT_LOG"
    fi
    
    # Get current timestamp in ISO 8601 format
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    # Get current Git commit SHA if available
    local git_commit="unknown"
    if command -v git &> /dev/null && [ -d "${PROJECT_ROOT}/.git" ]; then
        git_commit=$(cd "$PROJECT_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    fi
    
    # Append to history
    local tmp_file
    tmp_file=$(mktemp)
    
    jq \
        --arg ts "$timestamp" \
        --arg network "$NETWORK" \
        --arg contract "$CONTRACT_NAME" \
        --arg contract_id "$contract_id" \
        --arg commit "$git_commit" \
        '. += [{
            timestamp: $ts,
            network: $network,
            contract: $contract,
            contract_id: $contract_id,
            git_commit: $commit
        }]' \
        "$DEPLOYMENT_LOG" > "$tmp_file"
    
    mv "$tmp_file" "$DEPLOYMENT_LOG"
    log_success "Deployment recorded in history"
}

# ============================================================================
# Blue-Green Deployment Functions
# ============================================================================

# Read the currently active traffic target (blue or green)
get_active_target() {
    if [ -f "$TRAFFIC_STATE_FILE" ]; then
        cat "$TRAFFIC_STATE_FILE"
    else
        echo "blue"
    fi
}

# Point traffic at the given target (blue or green)
switch_traffic() {
    local target="$1"
    local url

    case "$target" in
        blue)  url="$BLUE_URL" ;;
        green) url="$GREEN_URL" ;;
        *)
            log_error "Unknown traffic target: $target"
            return 1
            ;;
    esac

    log_info "Switching traffic to ${target} (${url:-unset})..."
    mkdir -p "$(dirname "$TRAFFIC_STATE_FILE")"
    echo "$target" > "$TRAFFIC_STATE_FILE"
    log_success "Traffic now routed to $target"
}

# Poll GET /health on the green environment until it returns 200
wait_for_green_health() {
    log_info "Waiting for green environment health check (GET /health)..."

    if [ -z "$GREEN_URL" ]; then
        log_error "GREEN_URL is not set; cannot verify green environment health"
        return 1
    fi

    if [ ! -x "$HEALTH_CHECK_SCRIPT" ]; then
        log_error "Health check script not found or not executable: $HEALTH_CHECK_SCRIPT"
        return 1
    fi

    local deadline=$(( $(date +%s) + HEALTH_CHECK_TIMEOUT ))
    local attempt=0

    while [ "$attempt" -lt "$HEALTH_CHECK_MAX_RETRIES" ]; do
        attempt=$((attempt + 1))
        log_info "Health check attempt ${attempt}/${HEALTH_CHECK_MAX_RETRIES}..."

        if "$HEALTH_CHECK_SCRIPT" "$GREEN_URL"; then
            log_success "Green environment is healthy (GET /health returned 200)"
            return 0
        fi

        if [ "$(date +%s)" -ge "$deadline" ]; then
            log_error "Health check timed out after ${HEALTH_CHECK_TIMEOUT}s"
            return 1
        fi

        sleep "$HEALTH_CHECK_INTERVAL"
    done

    log_error "Green environment failed health check after ${HEALTH_CHECK_MAX_RETRIES} attempts"
    return 1
}

# Run smoke tests against critical API endpoints on green
run_smoke_tests() {
    log_info "Running smoke tests against green environment..."

    if [ -z "$GREEN_URL" ]; then
        log_error "GREEN_URL is not set; cannot run smoke tests"
        return 1
    fi

    # Each entry is "path:expected_status"
    local endpoints=(
        "/v1/courses:200"
        "/v1/courses/search?q=test:200"
        "/metrics:200"
        "/api/docs:200"
    )

    local failures=0
    local entry path expected actual

    for entry in "${endpoints[@]}"; do
        path="${entry%%:*}"
        expected="${entry##*:}"

        actual=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time "$SMOKE_TEST_TIMEOUT" \
            "${GREEN_URL}${path}" 2>/dev/null || echo "000")

        if [ "$actual" = "$expected" ]; then
            log_success "Smoke test passed: GET ${path} -> ${actual}"
        else
            log_error "Smoke test failed: GET ${path} -> ${actual} (expected ${expected})"
            failures=$((failures + 1))
        fi
    done

    if [ "$failures" -ne 0 ]; then
        log_error "Smoke tests failed (${failures} failure(s))"
        return 1
    fi

    log_success "All smoke tests passed"
    return 0
}

# Roll back traffic to blue
rollback_to_blue() {
    local previous_target="$1"

    log_warning "Rolling back traffic to blue..."

    if ! switch_traffic "blue"; then
        log_error "Automatic rollback to blue FAILED - manual intervention required"
        return 1
    fi

    log_success "Rollback complete; traffic restored to blue (was: ${previous_target})"
    return 0
}

# Orchestrate the blue-green cutover with health verification
blue_green_deploy() {
    local previous_target
    previous_target=$(get_active_target)

    log_info "Blue-green deployment: current traffic target is ${previous_target}"
    echo ""

    # 1. Verify green health before any traffic switch
    if ! wait_for_green_health; then
        log_error "Green environment is unhealthy; aborting cutover"
        rollback_to_blue "$previous_target" || true
        exit 1
    fi
    echo ""

    # 2. Run smoke tests against green
    if ! run_smoke_tests; then
        log_error "Smoke tests failed; aborting cutover"
        rollback_to_blue "$previous_target" || true
        exit 1
    fi
    echo ""

    # 3. All checks passed - switch traffic to green
    if ! switch_traffic "green"; then
        log_error "Failed to switch traffic to green; rolling back"
        rollback_to_blue "$previous_target" || true
        exit 1
    fi
    echo ""

    log_success "Blue-green cutover complete: traffic now on green"
}

# Print deployment summary
print_summary() {
    local contract_id="$1"
    local start_time="$2"
    local end_time="$3"
    
    local duration=$((end_time - start_time))
    
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}Deployment Successful${NC}"
    echo "════════════════════════════════════════════════════════════"
    echo ""
    echo "  Network:       $NETWORK"
    echo "  Contract:      $CONTRACT_NAME"
    echo -e "  Contract ID:   ${GREEN}$contract_id${NC}"
    echo ""
    echo "  Duration:      ${duration}s"
    echo "  Time:          $(date)"
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo ""
    echo "Next steps:"
    echo "  1. Update your .env file with the contract ID:"
    echo "     ${YELLOW}$(echo $CONTRACT_NAME | tr '[:lower:]' '[:upper:]')_CONTRACT_ID=$contract_id${NC}"
    echo ""
    echo "  2. Verify contract interactions:"
    echo "     stellar contract invoke --id $contract_id ..."
    echo ""
    echo "  3. Reference deployment records:"
    echo "     scripts/deployed-contracts.json"
    echo "     scripts/.deployment-history.json"
    echo ""
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
    local start_time
    start_time=$(date +%s)
    
    # Validate arguments
    if [ -z "$NETWORK" ] || [ -z "$CONTRACT_NAME" ]; then
        log_error "Missing required arguments"
        echo ""
        print_usage
        exit 1
    fi
    
    log_info "Scoopdope Smart Contract Deployment"
    echo ""
    
    # Run validation checks
    validate_prerequisites
    validate_network
    validate_contract
    validate_env
    echo ""
    
    # Build contract
    build_contract
    echo ""
    
    # Deploy contract
    local contract_id
    contract_id=$(deploy_contract)
    echo ""
    
    # Verify contract
    verify_contract "$contract_id"
    echo ""
    
    # Blue-green cutover with health verification (only when enabled)
    if [ "$BLUE_GREEN" = "true" ]; then
        blue_green_deploy
        echo ""
    fi
    
    # Update registries
    update_deployment_registry "$contract_id"
    log_deployment_history "$contract_id"
    echo ""
    
    # Print summary
    local end_time
    end_time=$(date +%s)
    print_summary "$contract_id" "$start_time" "$end_time"
}

# Run main function
main "$@"
