SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

voicecode: ## Launch VoiceCode BBS
	. voicecode-bbs/venv/bin/activate && python voicecode-bbs/voicecode_bbs.py

spa-install: ## Install SPA frontend dependencies
	cd frontend && npm install

spa-dev: ## Start the SPA dev server (Ctrl-C to stop)
	@if [ ! -d frontend/node_modules ]; then \
	   echo "Running npm install first..."; \
	   cd frontend && npm install; \
	 fi
	cd frontend && npm run dev

spa-build: ## Build the SPA for production (output: frontend/dist/)
	@if [ ! -d frontend/node_modules ]; then \
	   echo "Running npm install first..."; \
	   cd frontend && npm install; \
	 fi
	cd frontend && npm run build
	@echo ""
	@echo "SPA built to frontend/dist/"

.PHONY: help voicecode spa-install spa-dev spa-build
