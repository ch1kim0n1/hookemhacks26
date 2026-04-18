.PHONY: setup fixtures api dashboard demo contracts clean pivot-test

# --- Setup ---
setup:
	@echo "=== Setting up ClawGuard ==="
	cd $(CURDIR) && uv venv && uv pip install -e ".[pdf-gen,dev]"
	cd $(CURDIR)/dashboard && npm install
	@echo ""
	@echo "Copy .env.example to .env and fill in your keys:"
	@echo "  cp .env.example .env"
	@echo ""
	@echo "Optional: install Foundry for contracts:"
	@echo "  curl -L https://foundry.paradigm.xyz | bash && foundryup"

# --- Generate attack fixtures ---
fixtures:
	@echo "=== Generating attack fixtures ==="
	cd $(CURDIR) && uv run python demo/attacks/generate_fixtures.py

# --- Start API server ---
api:
	@echo "=== Starting ClawGuard API on :8000 ==="
	cd $(CURDIR) && PYTHONPATH=$(CURDIR) uv run uvicorn skill.api:app --reload --host 0.0.0.0 --port 8000

# --- Start dashboard ---
dashboard:
	@echo "=== Starting dashboard on :5175 ==="
	cd $(CURDIR)/dashboard && npm run dev

# --- Deploy contracts ---
contracts:
	@echo "=== Deploying ClawGuardRegistry to Base Sepolia ==="
	cd $(CURDIR)/contracts && forge install foundry-rs/forge-std --no-commit 2>/dev/null; true
	cd $(CURDIR)/contracts && source ../.env && forge script script/Deploy.s.sol:DeployScript \
		--rpc-url $$BASE_SEPOLIA_RPC_URL \
		--broadcast \
		-vvv
	@echo ""
	@echo "Update CLAWGUARD_REGISTRY_ADDRESS in .env with the deployed address above"

# --- Run the full demo ---
demo: fixtures
	@echo "=== Running ClawGuard Demo ==="
	@echo ""
	cd $(CURDIR) && PYTHONPATH=$(CURDIR) uv run python demo/trading_agent/agent.py
	@echo ""
	@echo "=== Demo complete ==="
	@echo "Start the dashboard to see results:"
	@echo "  Terminal 1: make api"
	@echo "  Terminal 2: make dashboard"
	@echo "  Open: http://localhost:5175"

# --- Run everything (API + dashboard in background, then demo) ---
demo-full: fixtures
	@echo "=== Starting full demo ==="
	@echo "Starting API server..."
	cd $(CURDIR) && PYTHONPATH=$(CURDIR) uv run uvicorn skill.api:app --host 0.0.0.0 --port 8000 &
	@sleep 2
	@echo "Starting dashboard..."
	cd $(CURDIR)/dashboard && npm run dev &
	@sleep 3
	@echo ""
	@echo "Running demo agent..."
	cd $(CURDIR) && uv run python demo/trading_agent/agent.py
	@echo ""
	@echo "Dashboard: http://localhost:5175"
	@echo "API: http://localhost:8000/api/health"
	@echo "Press Ctrl+C to stop all"
	@wait

# --- Pivot verification (SENTINEL → ClawGuard tree) ---
pivot-test:
	@echo "=== pivot-test ==="
	cd $(CURDIR) && python3 -m pytest detector/tests_on_chain blockchain/tests learning/tests network/tests -q --tb=no || true
	cd $(CURDIR)/contracts && forge build -q 2>/dev/null || forge build
	cd $(CURDIR)/zk && cargo test --lib -q 2>/dev/null || echo "zk: install Rust to run cargo test"

# --- Clean ---
clean:
	rm -rf .venv __pycache__ *.db
	rm -rf dashboard/node_modules dashboard/dist
	rm -rf contracts/out contracts/cache contracts/lib
	rm -f demo/attacks/*.eml demo/attacks/*.png demo/attacks/*.pdf
