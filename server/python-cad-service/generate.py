"""CAD generation CLI.

Reads a furniture spec JSON from stdin OR --spec-file, runs the right
builder, writes the manufacturer bundle to --out-dir, prints the summary
JSON to stdout.

Usage:
    python -m server.python-cad-service.generate \\
        --spec-file /tmp/spec.json \\
        --out-dir /tmp/cad-out

Or via stdin:
    cat spec.json | python -m server.python-cad-service.generate \\
        --out-dir /tmp/cad-out
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# Make this script runnable both as `python -m server.python-cad-service.generate`
# and `python generate.py` from inside the service directory.
if __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = "python-cad-service"  # for sibling imports

from .builders import build
from .common import write_outputs


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--spec-file", type=Path, help="JSON file with the spec (or use stdin)")
    p.add_argument("--out-dir", type=Path, required=True, help="Where to write CAD bundle")
    args = p.parse_args()

    if args.spec_file:
        spec = json.loads(args.spec_file.read_text())
    else:
        spec = json.loads(sys.stdin.read())

    t0 = time.time()
    result = build(spec)
    summary = write_outputs(result, args.out_dir)
    summary["elapsed_seconds"] = round(time.time() - t0, 2)
    summary["out_dir"] = str(args.out_dir.resolve())

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
