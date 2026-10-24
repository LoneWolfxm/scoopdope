#!/usr/bin/env python3
"""Verify that every governance event stays within the 16 KiB footprint limit."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = REPO_ROOT / "tests" / "fixtures" / "event_snapshots"
MAX_EVENT_BYTE_BUDGET = 16_384  # 16 KiB Soroban protocol limit


def verify_all_event_bytes() -> tuple[bool, list[str]]:
    problems = []
    if not SNAPSHOT_DIR.exists():
        return False, [f"Snapshot directory missing: {SNAPSHOT_DIR}"]

    snapshots = list(SNAPSHOT_DIR.glob("*.json"))
    if not snapshots:
        return False, ["No golden event snapshots found to verify"]

    for snap in snapshots:
        try:
            data = json.loads(snap.read_text(encoding="utf-8"))
            footprint = data.get("raw_bytes_footprint", 0)
            event_name = data.get("event", snap.stem)
            if footprint > MAX_EVENT_BYTE_BUDGET:
                problems.append(
                    f"Event {event_name} exceeds budget: {footprint} > {MAX_EVENT_BYTE_BUDGET} bytes"
                )
        except Exception as e:
            problems.append(f"Failed to parse {snap.name}: {e}")

    return len(problems) == 0, problems


def main() -> int:
    ok, problems = verify_all_event_bytes()
    if ok:
        print("All governance event payloads stay strictly within the 16 KiB footprint limit.")
        return 0
    else:
        for p in problems:
            print(f"Error: {p}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
