---
name: hermes-obsidian
description: Manage the Obsidian team vault with provenance, structured search, controlled ingest, integrity checks, deduplication, and Git-aware handoff.
whenToUse: Use only when a team knowledge-vault path is explicitly configured and supplied by the user in this session; read that vault's SCHEMA.md before creating or changing notes.
metadata:
  source: Hermes obsidian
  source-sha256: e7090b513cc27ef888002d995ea3cfc7be71d190dce79e592949d17aeff6c68d
  migration-batch: '1'
---

# Knowledge Vault Management (Obsidian format)

KNOWLEDGE VAULT: not configured in DSH — do not assume this path exists. The OMP source configured the vault at `/Users/lmqhx/wiki`; use this skill only for a vault path that the user explicitly supplies in this session. Read the target vault's `SCHEMA.md` before creating or changing notes. Treat `raw/` as immutable provenance: only the controlled ingest script may add its required frontmatter; never rewrite source bodies.

## Query workflow

1. Read `index.md` and locate relevant pages with full-text search.
2. Read the candidate pages and their cited sources before making a claim.
3. Distinguish source facts, synthesis, and inference.
4. When updating knowledge, preserve frontmatter, add meaningful wikilinks, update `index.md`, and add a chronological `log.md` entry.

## Controlled commands

All scripts require an explicit vault path or `OBSIDIAN_VAULT`. Run them from this skill's directory: the `scripts/` paths below are relative to this skill bundle.

```bash
# $VAULT is the vault path supplied by the user for this session
python3 scripts/wiki_ingest.py --check-all "$VAULT/raw"
python3 scripts/wiki_lint.py "$VAULT"
python3 scripts/wiki_dedup.py "$VAULT" 0.55
```

- `wiki_ingest.py`: add/check/rehash raw-source frontmatter and SHA-256. `--rehash*` changes provenance metadata and needs user authorization.
- `wiki_lint.py`: reports broken links, missing metadata, orphan pages, index drift, taxonomy drift, stale pages, and oversize pages. It never changes files.
- `wiki_dedup.py`: reports similarity candidates only. It never merges or deletes notes.

## Team-workflow integration

The main Agent owns vault operations. Specialist Agents return repository-bound artifacts; the main Agent decides whether to index them. Never declare a draft, session memory, or lint result an effective team rule or ADR. User approval is required to change an effective standard or ADR, commit/push the vault, or perform destructive cleanup.
