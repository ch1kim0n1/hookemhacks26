"""Node identity and mesh topology helpers.

Each Fargate task gets:
  - ``CLAWGUARD_NODE_ID``        — "peer-a0", "validator-north", ...
  - ``CLAWGUARD_NODE_ROLE``      — "peer" | "validator" | "self"
  - ``CLAWGUARD_NODE_REGION``    — display string, e.g. "us-east-1"
  - ``CLAWGUARD_NODE_TENANT``    — display label, e.g. "acme.co"
  - ``CLAWGUARD_TOPOLOGY_JSON``  — the full mesh, identical on every task

The topology JSON is the source of truth for the dashboard graph — the
frontend pings any node's ``/api/network/topology`` and renders the mesh from
there. Gossip direction is encoded per-edge; the full max-3-outbound
invariant is enforced at Terraform-build time.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class NodeIdentity:
    node_id: str
    role: str
    region: str
    tenant: str


def node_identity() -> NodeIdentity:
    return NodeIdentity(
        node_id=os.getenv("CLAWGUARD_NODE_ID", "local-console"),
        role=os.getenv("CLAWGUARD_NODE_ROLE", "self"),
        region=os.getenv("CLAWGUARD_NODE_REGION", "local"),
        tenant=os.getenv("CLAWGUARD_NODE_TENANT", "you"),
    )


@lru_cache(maxsize=1)
def _load_topology_from_env() -> dict:
    raw = os.getenv("CLAWGUARD_TOPOLOGY_JSON", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    nodes = parsed.get("nodes") or []
    edges = parsed.get("edges") or []
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return {}
    return {"nodes": nodes, "edges": edges}


def mesh_topology() -> dict:
    """Return full topology, decorated with this node's identity as ``self_id``."""
    me = node_identity()
    topo = _load_topology_from_env()
    if topo:
        return {
            "self_id": me.node_id,
            "self_role": me.role,
            "self_region": me.region,
            "self_tenant": me.tenant,
            "source": "env",
            **topo,
        }
    # Fallback: single-node topology so the dashboard doesn't explode when the
    # operator runs one local instance. Matches the old /api/network shape so
    # the 14-node fabric and the single-node dev server both feed the same
    # graph component.
    return {
        "self_id": me.node_id,
        "self_role": me.role,
        "self_region": me.region,
        "self_tenant": me.tenant,
        "source": "fallback",
        "nodes": [
            {
                "id": me.node_id,
                "role": me.role,
                "region": me.region,
                "tenant": me.tenant,
            }
        ],
        "edges": [],
    }
