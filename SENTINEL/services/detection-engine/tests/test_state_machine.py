"""Unit tests for the 4-state detection state machine."""
import time

import pytest
from detection_engine.state_machine import DetectionStateMachine


def test_idle_to_flash_loan_observed():
    sm = DetectionStateMachine()
    state = sm.observe_flash_loan("0xattacker", "1000000", "0xprovider")
    assert state.state == "FLASH_LOAN_OBSERVED"
    assert state.confidence == 0.4


def test_full_3_step_progression():
    sm = DetectionStateMachine()
    sm.observe_flash_loan("0xattacker", "1000000", "0xprovider")
    sm.observe_oracle_impact("0xattacker", 5.0)
    state = sm.observe_exploit_call("0xattacker", "0x12345678", "0xtarget")
    assert state.state == "CONFIRMED"
    assert state.confidence >= 0.85


def test_direct_exploit_reaches_confirmed():
    """The demo flow: FlashLoanAttacker tx arrives without prior observations."""
    sm = DetectionStateMachine()
    state = sm.observe_exploit_call("0xattacker", "0x12345678", "0xtarget")
    assert state.confidence >= 0.85
    assert state.state == "CONFIRMED"


def test_candidate_threshold():
    sm = DetectionStateMachine()
    state = sm.observe_flash_loan("0xattacker", "1000000", "0xprovider")
    level = sm.get_confidence_level(state)
    assert level == "below_threshold"  # 0.4 < 0.6


def test_window_expiry():
    sm = DetectionStateMachine(window_seconds=0)  # Immediate expiry
    sm.observe_flash_loan("0xattacker", "1000000", "0xprovider")
    time.sleep(0.01)
    state = sm._get_or_create("0xattacker")
    assert state.state == "IDLE"  # Expired, fresh state


def test_oracle_impact_multiplicative_confidence():
    sm = DetectionStateMachine()
    sm.observe_flash_loan("0xattacker", "1000000", "0xprovider")
    # deviation=5.0 → deviation_factor = min(5.0/10.0, 0.7) = 0.5
    # confidence = 0.4 * (0.3 + 0.5) = 0.4 * 0.8 = 0.32
    state = sm.observe_oracle_impact("0xattacker", 5.0)
    assert state.state == "ORACLE_IMPACT_OBSERVED"
    assert abs(state.confidence - 0.32) < 1e-9


def test_flash_loan_only_not_above_candidate_threshold():
    sm = DetectionStateMachine()
    state = sm.observe_flash_loan("0xaddr", "999", "0xprovider")
    assert sm.get_confidence_level(state) == "below_threshold"


def test_multiple_addresses_independent():
    sm = DetectionStateMachine()
    sm.observe_flash_loan("0xaddr1", "1000", "0xprovider")
    sm.observe_exploit_call("0xaddr2", "0xabcd1234", "0xtarget")

    state1 = sm.states["0xaddr1"]
    state2 = sm.states["0xaddr2"]
    assert state1.state == "FLASH_LOAN_OBSERVED"
    assert state2.state == "CONFIRMED"


def test_cleanup_expired():
    sm = DetectionStateMachine(window_seconds=0)
    sm.observe_flash_loan("0xaddr1", "1000", "0xprovider")
    sm.observe_flash_loan("0xaddr2", "2000", "0xprovider")
    time.sleep(0.01)
    removed = sm.cleanup_expired()
    assert removed == 2
    assert len(sm.states) == 0


def test_confirmed_state_not_overwritten():
    """Once CONFIRMED, subsequent exploit calls don't reset state."""
    sm = DetectionStateMachine()
    sm.observe_exploit_call("0xattacker", "0x12345678", "0xtarget")
    state = sm.observe_exploit_call("0xattacker", "0x12345678", "0xtarget")
    assert state.state == "CONFIRMED"
    assert state.confidence >= 0.85
