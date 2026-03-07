"""
tests/backend/test_pricing.py — Unit tests for the cost calculation module.
"""

from __future__ import annotations

from backend.core.pricing import calculate_cost


def test_known_model_cost():
    record = calculate_cost("gpt-4o-mini", prompt_tokens=1000, completion_tokens=500)
    expected = (1000 * 0.00015 + 500 * 0.0006) / 1000
    assert abs(record.cost_usd - expected) < 1e-9
    assert record.total_tokens == 1500


def test_unknown_model_uses_default_rate():
    record = calculate_cost("some-future-model", prompt_tokens=100, completion_tokens=100)
    # Should not raise; cost should be positive
    assert record.cost_usd > 0


def test_prefix_match():
    """gpt-4o-2024-... should match the gpt-4o pricing entry."""
    record = calculate_cost("gpt-4o-2024-05-13", prompt_tokens=1000, completion_tokens=1000)
    expected = (1000 * 0.005 + 1000 * 0.015) / 1000
    assert abs(record.cost_usd - expected) < 1e-9
