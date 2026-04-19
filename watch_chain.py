import time
from skill.chain.client import ChainClient

c = ChainClient()
print(f"Watching {c.registry_address} on Base Sepolia...")
print("Send your Discord message now!\n")

seen = set()
while True:
    attacks = c.poll_recent(50)
    for a in attacks:
        h = a["pattern_hash"]
        if h not in seen:
            seen.add(h)
            print("NEW ATTACK ON CHAIN")
            print(f"  category : {a['category']}")
            print(f"  hash     : {h}")
            print(f"  sample   : {a['sample_redacted']}")
            print(f"  reporter : {a['reporter']}")
            print(f"  block    : {a['block_number']}")
            print()
    time.sleep(5)
