"""Resolve psql relative includes locally before streaming into the fake container."""
import pathlib
import re
import sys

def expand(path):
    path = pathlib.Path(path).resolve()
    for line in path.read_text().splitlines(keepends=True):
        match = re.fullmatch(r"\\ir\s+(.+?)\s*\n?", line)
        if match:
            yield from expand(path.parent / match.group(1))
        else:
            yield line

sys.stdout.write("".join(expand(sys.argv[1])))
