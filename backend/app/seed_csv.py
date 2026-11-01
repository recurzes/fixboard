import csv
import sys
from pathlib import Path


def read_csv(path: str | Path, columns: tuple[str, ...]) -> list[tuple[int, dict[str, str]]]:
    """Returns (line number, stripped row) pairs. Exits on a bad file, without printing any row."""
    # utf-8-sig because Excel's "CSV UTF-8" export starts with a BOM.
    with open(path, encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        missing = set(columns) - set(reader.fieldnames or [])
        if missing:
            sys.exit(f"Missing columns: {', '.join(sorted(missing))}")
        rows = [
            (reader.line_num, {column: (row[column] or "").strip() for column in columns})
            for row in reader
        ]
    if not rows:
        sys.exit("The file has no rows")
    return rows
