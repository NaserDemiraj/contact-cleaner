"""Run GENESIS's listclean.py on CSV files and print what it found, as JSON.

The engine tests compare the browser port against this reference.
Usage: python py_reference.py LISTCLEAN_DIR FILE.csv [FILE.csv ...]
"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, sys.argv[1])
import listclean  # noqa: E402

out = {}
for path in sys.argv[2:]:
    with open(path, "rb") as f:
        text, _ = listclean.decode(f.read())
    header, rows, lines, groups, report = listclean.clean(text)
    out[path] = {
        "report": {k: report[k] for k in (
            "rows_in", "rows_out", "blank_rows_removed", "exact_duplicates_removed",
            "values_dropped_from_ragged_rows", "duplicate_groups_for_review",
            "rows_in_review_groups")},
        "skipped": sorted(report["skipped_common_tokens"]),
        "groups": [{"lines": [lines[i] for i in g["rows"]], "reason": g["reason"],
                    "similarity": g["similarity"]} for g in groups],
        "rows": rows,
    }
json.dump(out, sys.stdout, ensure_ascii=False)
