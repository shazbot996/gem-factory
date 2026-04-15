SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

voicecode: ## Launch VoiceCode BBS
	. voicecode-bbs/venv/bin/activate && python voicecode-bbs/voicecode_bbs.py

DB_CONFIG := .db-config

db-init: ## Set up database connection config (interactive)
	@echo "=== Gem Factory Database Setup ==="
	@echo ""
	@read -p "Database host [localhost]: " db_host; \
	 read -p "Database port [5432]: " db_port; \
	 read -p "Database user [postgres]: " db_user; \
	 read -sp "Database password: " db_pass; echo ""; \
	 read -p "Database name [gem_factory]: " db_name; \
	 db_host=$${db_host:-localhost}; \
	 db_port=$${db_port:-5432}; \
	 db_user=$${db_user:-postgres}; \
	 db_name=$${db_name:-gem_factory}; \
	 echo "DB_HOST=$$db_host" > $(DB_CONFIG); \
	 echo "DB_PORT=$$db_port" >> $(DB_CONFIG); \
	 echo "DB_USER=$$db_user" >> $(DB_CONFIG); \
	 echo "DB_PASS=$$db_pass" >> $(DB_CONFIG); \
	 echo "DB_NAME=$$db_name" >> $(DB_CONFIG); \
	 chmod 600 $(DB_CONFIG); \
	 echo ""; \
	 echo "Config saved to $(DB_CONFIG)"; \
	 echo ""
	@$(MAKE) --no-print-directory db-test
	@echo ""
	@. $(DB_CONFIG) && \
	 result=$$(PGPASSWORD="$$DB_PASS" psql -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d "$$DB_NAME" -tAc "SELECT 1" 2>&1) || true; \
	 if echo "$$result" | grep -q "does not exist"; then \
	   echo "Database '$$DB_NAME' does not exist. Creating..."; \
	   PGPASSWORD="$$DB_PASS" psql -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d postgres -c "CREATE DATABASE \"$$DB_NAME\""; \
	   echo "Database '$$DB_NAME' created successfully."; \
	 fi

db-test: ## Test database connection and verify privileges
	@if [ ! -f $(DB_CONFIG) ]; then \
	   echo "Error: $(DB_CONFIG) not found. Run 'make db-init' first."; \
	   exit 1; \
	 fi
	@. $(DB_CONFIG) && \
	 echo "Testing connection to $$DB_HOST:$$DB_PORT as $$DB_USER..."
	@. $(DB_CONFIG) && \
	 pg_isready -h "$$DB_HOST" -p "$$DB_PORT" -q && \
	   echo "[OK] Server is accepting connections" || \
	   { echo "[FAIL] Cannot reach server at $$DB_HOST:$$DB_PORT"; exit 1; }
	@. $(DB_CONFIG) && \
	 PGPASSWORD="$$DB_PASS" psql -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d "$$DB_NAME" -tAc "SELECT 1" > /dev/null 2>&1 && \
	   echo "[OK] Authenticated and connected to '$$DB_NAME'" || \
	   { \
	     PGPASSWORD="$$DB_PASS" psql -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d postgres -tAc "SELECT 1" > /dev/null 2>&1 && \
	       echo "[OK] Authenticated (database '$$DB_NAME' may not exist yet)" || \
	       { echo "[FAIL] Authentication failed for user '$$DB_USER'"; exit 1; }; \
	   }
	@. $(DB_CONFIG) && \
	 test_db="$$DB_NAME"; \
	 PGPASSWORD="$$DB_PASS" psql -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d "$$DB_NAME" -tAc "SELECT 1" > /dev/null 2>&1 || test_db=postgres; \
	 is_super=$$(PGPASSWORD="$$DB_PASS" psql -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d "$$test_db" -tAc " \
	   SELECT usesuper FROM pg_user WHERE usename = current_user" 2>/dev/null) && \
	 can_createdb=$$(PGPASSWORD="$$DB_PASS" psql -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d "$$test_db" -tAc " \
	   SELECT usecreatedb OR usesuper FROM pg_user WHERE usename = current_user" 2>/dev/null) && \
	 echo "[OK] Privilege check:" && \
	 if [ "$$is_super" = "t" ]; then \
	   echo "     Superuser: yes (full privileges)"; \
	 else \
	   echo "     Superuser: no"; \
	   echo "     Can create databases: $$can_createdb"; \
	   if [ "$$test_db" = "postgres" ]; then \
	     echo "     (Database '$$DB_NAME' does not exist yet — will be created by db-init)"; \
	   else \
	     can_create=$$(PGPASSWORD="$$DB_PASS" psql -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d "$$test_db" -tAc " \
	       SELECT has_schema_privilege(current_user, 'public', 'CREATE')" 2>/dev/null) && \
	     echo "     CREATE in public schema: $$can_create"; \
	     if [ "$$can_create" != "t" ]; then \
	       echo "     [WARN] User may lack privileges to create tables."; \
	     fi; \
	   fi; \
	 fi

api-start: ## Start the API server (Docker Compose, DB via .db-config)
	@if [ ! -f $(DB_CONFIG) ]; then \
	   echo "Error: $(DB_CONFIG) not found. Run 'make db-init' first."; \
	   exit 1; \
	 fi
	@. $(DB_CONFIG) && \
	 export DATABASE_URL="postgresql://$$DB_USER:$$DB_PASS@$$DB_HOST:$$DB_PORT/$$DB_NAME" && \
	 docker compose up -d --build
	@echo ""
	@echo "Gem Factory API running at http://localhost:9090"
	@. $(DB_CONFIG) && echo "Database: $$DB_HOST:$$DB_PORT/$$DB_NAME"
	@echo "  Stop with: make api-stop"
	@echo "  Logs with: docker compose logs -f api"

api-stop: ## Stop the API server
	docker compose down

api-test: ## Run API server tests (requires running containers)
	docker compose exec api node --test test/

api-logs: ## Tail API server logs
	docker compose logs -f api

spa-install: ## Install SPA frontend dependencies
	cd frontend && npm install

spa-dev: ## Start the SPA dev server (Ctrl-C to stop)
	@if [ ! -d frontend/node_modules ]; then \
	   echo "Running npm install first..."; \
	   cd frontend && npm install; \
	 fi
	cd frontend && npm run dev

spa-build: ## Build the SPA for production (output: server/public/)
	@if [ ! -d frontend/node_modules ]; then \
	   echo "Running npm install first..."; \
	   cd frontend && npm install; \
	 fi
	cd frontend && npm run build
	@echo ""
	@echo "SPA built to server/public/"
	@echo "Restart the API server (make api-start) to serve the new build."

.PHONY: help voicecode db-init db-test api-start api-stop api-test api-logs spa-install spa-dev spa-build
