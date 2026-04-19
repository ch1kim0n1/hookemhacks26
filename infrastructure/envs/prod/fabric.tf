# ---------------------------------------------------------------------------
# Decentralised ClawGuard fabric on AWS Fargate
#
# 12 peer nodes (6 in group A, 6 in group B) + 2 validator nodes sitting
# behind a single ALB. Each peer has exactly 3 outbound gossip links: 2
# nearby peers + 1 validator. Validators broadcast consensus to 3 peers
# each. The topology is baked into every task's env so every node can serve
# /api/network/topology with the full mesh for the dashboard.
#
# Why Fargate (for judge Q&A):
#   - Simulates real operators actually running ClawGuard as a sidecar next
#     to their OpenClaw agent in production — each Fargate task is one
#     tenant's isolated node with its own process, IP, logs, and IAM role.
#   - No cold starts; each node is always warm so demo click-through feels
#     real and never pauses to spin up Lambda.
#   - Easier to reason about from the judge's side: one cluster, 14 tasks,
#     one per node. They can click into any one in ECS and see it running.
# ---------------------------------------------------------------------------

locals {
  fabric_peer_count_per_group = 6
  fabric_validator_ids        = ["validator-north", "validator-south"]
  fabric_validator_regions    = ["us-east-1", "ap-southeast-1"]

  # Group A peers live in us-east-1 (same as our AWS region), group B peers
  # pretend to live in eu-west-1 so the dashboard shows visible geographic
  # spread.
  fabric_peer_a_ids = [for i in range(local.fabric_peer_count_per_group) : "peer-a${i}"]
  fabric_peer_b_ids = [for i in range(local.fabric_peer_count_per_group) : "peer-b${i}"]

  fabric_peer_ids = concat(local.fabric_peer_a_ids, local.fabric_peer_b_ids)

  # Each peer's 3 outbound links:
  #   - next peer within its own group (ring)
  #   - peer 3 away within its own group (chord)
  #   - the validator assigned to its group (A → north, B → south)
  fabric_peers_nodes_map = merge(
    {
      for i, id in local.fabric_peer_a_ids : id => {
        role   = "peer"
        region = "us-east-1"
        tenant = "acme-${format("%02d", i)}.co"
        peer_ids = [
          local.fabric_peer_a_ids[(i + 1) % local.fabric_peer_count_per_group],
          local.fabric_peer_a_ids[(i + 3) % local.fabric_peer_count_per_group],
          "validator-north",
        ]
      }
    },
    {
      for i, id in local.fabric_peer_b_ids : id => {
        role   = "peer"
        region = "eu-west-1"
        tenant = "labs-${format("%02d", i)}.io"
        peer_ids = [
          local.fabric_peer_b_ids[(i + 1) % local.fabric_peer_count_per_group],
          local.fabric_peer_b_ids[(i + 3) % local.fabric_peer_count_per_group],
          "validator-south",
        ]
      }
    },
  )

  # Each validator gossips to 3 peers in the opposite group (so the two groups
  # share threat intel through validators, not peer-to-peer).
  fabric_validators_map = {
    "validator-north" = {
      role     = "validator"
      region   = "us-east-1"
      tenant   = "validator-north.clawguard.net"
      peer_ids = [local.fabric_peer_b_ids[0], local.fabric_peer_b_ids[2], local.fabric_peer_b_ids[4]]
    }
    "validator-south" = {
      role     = "validator"
      region   = "ap-southeast-1"
      tenant   = "validator-south.clawguard.net"
      peer_ids = [local.fabric_peer_a_ids[1], local.fabric_peer_a_ids[3], local.fabric_peer_a_ids[5]]
    }
  }

  fabric_nodes = merge(local.fabric_peers_nodes_map, local.fabric_validators_map)
}

variable "enable_fabric" {
  description = "Turn on the 14-node Fargate fabric (ALB + ECS + logs). Costs ~$1-2/day."
  type        = bool
  default     = true
}

variable "fabric_container_image" {
  description = "Full ECR URI:tag for the ClawGuard fabric node image."
  type        = string
  default     = "235921997878.dkr.ecr.us-east-1.amazonaws.com/clawguard-fabric:v1"
}

module "fabric" {
  count  = var.enable_fabric ? 1 : 0
  source = "../../modules/fabric"

  name            = "${var.project}-fabric"
  container_image = var.fabric_container_image
  nodes           = local.fabric_nodes

  base_sepolia_rpc_url = var.base_sepolia_rpc_url
  registry_address     = var.registry_address

  cors_origins = join(",", [
    "https://${module.site.distribution_domain_name}",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ])

  task_cpu         = 256
  task_memory      = 512
  use_fargate_spot = true

  tags = { Env = "prod", Fabric = "clawguard" }
}

output "fabric_alb_dns" {
  description = "Public ALB DNS for the fabric. Use as VITE_API_BASE_URL in frontend build."
  value       = var.enable_fabric ? module.fabric[0].alb_dns_name : null
}

output "fabric_node_endpoints" {
  description = "Map of node_id => full URL."
  value       = var.enable_fabric ? module.fabric[0].node_endpoints : {}
}

output "fabric_topology_json" {
  description = "Full mesh topology baked into every task."
  value       = var.enable_fabric ? module.fabric[0].topology_json : ""
}
