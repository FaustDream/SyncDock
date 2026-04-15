from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class SyncResult:
    name: str
    outcome: str
    message: str


def summarize_results(results: list[SyncResult]) -> dict[str, int]:
    summary = {
        "total": len(results),
        "updated": 0,
        "up_to_date": 0,
        "skipped": 0,
        "failed": 0,
        "invalid": 0,
    }
    mapping = {
        "UPDATED": "updated",
        "UP_TO_DATE": "up_to_date",
        "SKIPPED": "skipped",
        "FAILED": "failed",
        "INVALID": "invalid",
    }
    for item in results:
        summary[mapping[item.outcome]] += 1
    return summary
