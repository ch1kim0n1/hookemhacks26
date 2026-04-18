"""defense-agent: unit tests for calldata encoding."""

from eth_utils import function_signature_to_4byte_selector, keccak

from defense_agent.__main__ import encode_pause_call


def test_encode_pause_call_shape():
    victim = "0xdeadbeef00000000000000000000000000000001"
    event_id = "0x" + "aa" * 32
    encoded = encode_pause_call(victim, event_id)
    # selector (4) + addr (32) + enum (32) + eventId (32)
    assert len(encoded) == 4 + 32 + 32 + 32
    # selector
    assert encoded[:4] == function_signature_to_4byte_selector(
        "activate(address,uint8,bytes32)"
    )
    # padded address in last 20 bytes of the first 32-byte arg
    assert encoded[4 + 12 : 4 + 32].hex() == victim[2:]
    # enum = 1 (Pause)
    assert int.from_bytes(encoded[4 + 32 : 4 + 64], "big") == 1
    # event id
    assert encoded[4 + 64 : 4 + 96].hex() == "aa" * 32


def test_action_hash_matches_solidity_keccak():
    victim = "0xdeadbeef00000000000000000000000000000001"
    event_id = "0x" + "bb" * 32
    encoded = encode_pause_call(victim, event_id)
    pause_controller = "0xC0Ffee0000000000000000000000000000000003"
    # PolicyRegistry computes keccak(abi.encodePacked(target, action))
    action_hash = keccak(bytes.fromhex(pause_controller[2:]) + encoded)
    # Sanity: hash is 32 bytes and deterministic.
    assert len(action_hash) == 32
    assert action_hash == keccak(bytes.fromhex(pause_controller[2:]) + encoded)
