---
name: clawguard
version: 0.1.0
description: Security middleware that defends OpenClaw agents against prompt injection attacks across text, images, PDFs, and audio.
author: ClawGuard Team
hooks:
  pre_tool:
    - tool: email_read
      handler: hook_registrar.intercept_entry
    - tool: web_fetch
      handler: hook_registrar.intercept_entry
    - tool: file_read
      handler: hook_registrar.intercept_entry
    - tool: image_view
      handler: hook_registrar.intercept_entry
    - tool: pdf_read
      handler: hook_registrar.intercept_entry
    - tool: audio_listen
      handler: hook_registrar.intercept_entry
dependencies:
  - pytesseract
  - pdfplumber
  - pypdf
  - openai-whisper
  - transformers
  - torch
  - web3
  - anthropic
  - Pillow
  - beautifulsoup4
  - lxml
requires_env:
  - ANTHROPIC_API_KEY
  - BASE_SEPOLIA_RPC_URL
  - CLAWGUARD_REGISTRY_ADDRESS
  - CLAWGUARD_PRIVATE_KEY
optional_env:
  - OPENAI_API_KEY
  - CLAWGUARD_DEPLOY_PROFILE
  - CLAWGUARD_ADDRESSES_FILE
---

# ClawGuard

Pre-processing security skill for OpenClaw agents. Intercepts all inbound content
(email, web, files, images, audio) before the agent processes it. Runs a three-layer
injection detection pipeline and shares threat intel on-chain.

**Audio scope (issue #95):** `audio_listen` is supported when the optional Whisper /
`openai-whisper` stack is installed; otherwise extraction degrades gracefully and
the manifest still lists the hook for forward compatibility.

## How it works

1. **Extraction** — pulls text from every modality (OCR, PDF parse, Whisper, HTML strip)
2. **Detection** — regex rules -> ML classifier -> LLM judge (short-circuits on confidence)
3. **Verdict** — pass / sanitize / block with reasons
4. **Threat intel** — publishes attack hashes to Base Sepolia, polls for new patterns

## Hook behavior

When a hooked tool is called, ClawGuard:
- Extracts all text from the content
- Checks hash against cached on-chain threat feed (instant block)
- Runs detection pipeline
- If `block`: raises `ContentBlocked` and logs the attempt
- If `sanitize`: replaces content with cleaned version, adds warning
- If `pass`: forwards content unchanged
