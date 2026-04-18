# ZK guest naming (ClawGuard pivot)

| ClawGuard name (`absolute-docs`) | Crate directory (`zk/guest/`) | Notes |
|----------------------------------|-------------------------------|--------|
| scan-attestation | `policy-compliance` | Rename pending — same RISC0 guest |
| defense-update-correctness | `learning-correctness` | Rename pending |
| *(removed per plan)* | `counterfactual-correctness` | Still in tree until host binary graph is updated |

Build: `cd zk && cargo build --release -p sentinel-zk-host`
