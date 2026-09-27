# =============================================================================
#  VestFlow — Hardhat-style task runner
#  Targets: build, optimize, deploy, upgrade, create-schedule, claim, revoke
#
#  Environment variables (with defaults):
#    NETWORK      = testnet | mainnet   (default: testnet)
#    RPC_URL      = Soroban RPC endpoint
#    SOURCE       = Stellar CLI key identity / seed
#    CONTRACT_ID  = Deployed contract ID
# =============================================================================

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

# ── Config (overridable via env) ─────────────────────────────────────────────
NETWORK       ?= testnet
RPC_URL       ?= https://soroban-testnet.stellar.org
SOURCE        ?= $(or $(STELLAR_ACCOUNT),admin)
CONTRACT_ID   ?= $(NEXT_PUBLIC_CONTRACT_ID)

ifeq ($(NETWORK),mainnet)
  NETWORK_PASSPHRASE := "Public Global Stellar Network ; September 2015"
else
  NETWORK_PASSPHRASE := "Test SDF Network ; September 2015"
endif

WASM_PATH     := contracts/target/wasm32v1-none/release/vestflow.wasm
OPT_WASM_PATH := contracts/target/wasm32v1-none/release/vestflow.optimized.wasm

# ── Help ─────────────────────────────────────────────────────────────────────
help:
	@echo "Usage:  make <target> [NETWORK=mainnet] [CONTRACT_ID=...]"
	@echo ""
	@echo "Targets:"
	@echo "  build             Build release WASM"
	@echo "  optimize          Build and optimize release WASM"
	@echo "  cost              Profile a read-only entry point with stellar contract invoke --cost"
	@echo "  deploy            Build, optimize, and deploy the VestFlow contract"
	@echo "  upload-wasm       Upload optimized WASM and print the WASM hash"
	@echo "  announce-upgrade  Announce a WASM hash for the configured contract"
	@echo "  execute-upgrade   Execute the announced upgrade after the timelock"
	@echo "  create-schedule   Create a new vesting schedule"
	@echo "  claim             Claim vested tokens for a schedule"
	@echo "  revoke            Revoke a vesting schedule"
	@echo "  api-install       Install API server dependencies"
	@echo "  api-dev           Run the API server in watch mode"
	@echo "  api-build         Type-check and build the API server"
	@echo ""
	@echo "Variables:"
	@echo "  NETWORK       Network (testnet/mainnet, default: testnet)"
	@echo "  RPC_URL       Soroban RPC URL"
	@echo "  SOURCE        Stellar CLI key identity"
	@echo "  CONTRACT_ID   Deployed contract ID"
	@echo ""
	@echo "Examples:"
	@echo "  make deploy"
	@echo "  make create-schedule NETWORK=mainnet CONTRACT_ID=CC..."
	@echo "  make claim CONTRACT_ID=CC... SCHEDULE_ID=1"

# ── Build ────────────────────────────────────────────────────────────────────
.PHONY: build
build:
	cargo build --target wasm32v1-none --release --manifest-path contracts/Cargo.toml

.PHONY: optimize
optimize: build
	stellar contract optimize \
		--wasm $(WASM_PATH) \
		--wasm-out $(OPT_WASM_PATH)

.PHONY: cost
cost:
	stellar contract invoke --cost \
		--id $(CONTRACT_ID) \
		--source $(SOURCE) \
		--network $(NETWORK) \
		--rpc-url $(RPC_URL) \
		--network-passphrase $(NETWORK_PASSPHRASE) \
		-- \
		$(METHOD) $(ARGS)

# ── Deploy ───────────────────────────────────────────────────────────────────
.PHONY: deploy
deploy: optimize
	stellar contract deploy \
		--wasm $(OPT_WASM_PATH) \
		--source $(SOURCE) \
		--network $(NETWORK) \
		--rpc-url $(RPC_URL) \
		--network-passphrase $(NETWORK_PASSPHRASE)

.PHONY: upload-wasm
upload-wasm: optimize
	stellar contract upload \
		--wasm $(OPT_WASM_PATH) \
		--source $(SOURCE) \
		--network $(NETWORK) \
		--rpc-url $(RPC_URL) \
		--network-passphrase $(NETWORK_PASSPHRASE)

.PHONY: announce-upgrade
announce-upgrade:
	stellar contract invoke \
		--id $(CONTRACT_ID) \
		--source $(SOURCE) \
		--network $(NETWORK) \
		--rpc-url $(RPC_URL) \
		--network-passphrase $(NETWORK_PASSPHRASE) \
		-- \
		announce_upgrade \
		--authority $(SOURCE) \
		--wasm-hash $(WASM_HASH)

.PHONY: execute-upgrade
execute-upgrade:
	stellar contract invoke \
		--id $(CONTRACT_ID) \
		--source $(SOURCE) \
		--network $(NETWORK) \
		--rpc-url $(RPC_URL) \
		--network-passphrase $(NETWORK_PASSPHRASE) \
		-- \
		execute_upgrade \
		--authority $(SOURCE)

# ── Create Schedule ──────────────────────────────────────────────────────────
.PHONY: create-schedule
create-schedule:
	stellar contract invoke \
		--id $(CONTRACT_ID) \
		--source $(SOURCE) \
		--network $(NETWORK) \
		--rpc-url $(RPC_URL) \
		--network-passphrase $(NETWORK_PASSPHRASE) \
		-- \
		create_schedule \
		--grantor $(GRANTOR) \
		--beneficiary $(BENEFICIARY) \
		--token $(TOKEN) \
		--total-amount $(TOTAL_AMOUNT) \
		--start-time $(START_TIME) \
		--duration $(DURATION) \
		--cliff-duration $(CLIFF_DURATION) \
		--kind $(KIND) \
		--revocable $(REVOCABLE)

# ── Claim ────────────────────────────────────────────────────────────────────
.PHONY: claim
claim:
	stellar contract invoke \
		--id $(CONTRACT_ID) \
		--source $(SOURCE) \
		--network $(NETWORK) \
		--rpc-url $(RPC_URL) \
		--network-passphrase $(NETWORK_PASSPHRASE) \
		-- \
		claim \
		--schedule-id $(SCHEDULE_ID)

# ── Revoke ───────────────────────────────────────────────────────────────────
.PHONY: revoke
revoke:
	stellar contract invoke \
		--id $(CONTRACT_ID) \
		--source $(SOURCE) \
		--network $(NETWORK) \
		--rpc-url $(RPC_URL) \
		--network-passphrase $(NETWORK_PASSPHRASE) \
		-- \
		revoke \
		--schedule-id $(SCHEDULE_ID)

# ── API server ───────────────────────────────────────────────────────────────
.PHONY: api-install
api-install:
	npm --prefix api install

.PHONY: api-dev
api-dev:
	npm --prefix api run dev

.PHONY: api-build
api-build:
	npm --prefix api run build
