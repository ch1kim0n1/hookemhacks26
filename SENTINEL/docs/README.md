# `docs/` — Operational Docs

Engineering and judge-facing documents that don't belong in [../absolute-docs/](../absolute-docs/) (the canonical system spec) or next to the code.

## Index

| Doc | Audience | Purpose |
|---|---|---|
| [setup-checklist.md](setup-checklist.md) | New contributor | Exact tool versions, platform notes, first-run path |
| [backup-laptop-setup.md](backup-laptop-setup.md) | Demo operator | Second-machine provisioning for the live demo |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Reviewer | Spec-vs-code map — what from [../absolute-docs/](../absolute-docs/) is built |
| [judge-qa.md](judge-qa.md) | Hackathon judge | Expected questions + ready answers |
| [post-hackathon-roadmap.md](post-hackathon-roadmap.md) | Sponsor / future maintainer | Done / partial / future, with rough timelines |
| [compliance/](compliance/) | Security / legal | SOC2-flavoured checklists |
| [runbooks/](runbooks/) | On-call | Incident response — start with [runbooks/restore.md](runbooks/restore.md) |
| [superpowers/](superpowers/) | Claude Code agents | Plans and history for assisted-development runs |

## Where to put new docs

- **Design or architecture** → [../absolute-docs/](../absolute-docs/) (numbered chapters)
- **How a subsystem works** → the subsystem's own README (e.g. [../zk/README.md](../zk/README.md), [../services/detection-engine/README.md](../services/detection-engine/README.md))
- **How to operate, observe, or recover** → here, under [runbooks/](runbooks/) or [compliance/](compliance/)
- **Spec of event payloads** → [../schemas/README.md](../schemas/README.md)
- **Demo scenarios** → [../config/demo-scenarios/README.md](../config/demo-scenarios/README.md)

Keeping these categories separate makes it easier for a reviewer to find what they need without reading everything.
