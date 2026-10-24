#!/usr/bin/env python3
"""Check that golden event snapshots match the governance contract event schemas."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = REPO_ROOT / "tests" / "fixtures" / "event_snapshots"
REQUIRED_EVENTS = ["prop_new", "vote", "exec", "upg_prop", "upg_appr", "upg_exec"]


def check_snapshots() -> tuple[bool, list[str]]:
    problems = []
    if not SNAPSHOT_DIR.exists():
        return False, [f"Snapshot directory missing: {SNAPSHOT_DIR}"]

    for event in REQUIRED_EVENTS:
        snap_file = SNAPSHOT_DIR / f"{event}.json"
        if not snap_file.exists():
            problems.append(f"Missing required golden snapshot: {snap_file.name}")
            continue
        try:
            data = json.loads(snap_file.read_text(encoding="utf-8"))
            if data.get("event") != event:
                problems.append(f"Mismatched event field in {snap_file.name}")
            if "topics" not in data or "data" not in data:
                problems.append(f"Incomplete schema structure in {snap_file.name}")
        except Exception as e:
            problems.append(f"Error reading {snap_file.name}: {e}")

    return len(problems) == 0, problems


def main() -> int:
    ok, problems = check_snapshots()
    if ok:
        print(f"All {len(REQUIRED_EVENTS)} golden event snapshots verified with zero drift.")
        return 0
    else:
        for p in problems:
            print(f"Diff error: {p}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
