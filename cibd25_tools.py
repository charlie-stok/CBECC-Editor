#!/usr/bin/env python3
"""
cibd25_tools.py

Parser, serializer, and batch-edit CLI for CBECC-Com/T24 .cibd25 (and .cibd22/.ribd25/
.cibd28, same grammar) project files.

FORMAT NOTES
------------
A .cibd25 file is NOT XML. It's a flat sequence of typed, named records:

    RulesetFilename   "T24_2025.bin"

    Proj   "MF8 with Retail Flr1"
       BldgEngyModelVersion = 17
       CliZn = "ClimateZone12"
       PVWDCSysSize = ( 1, 0, 0, 0, 0 )
       ..

    Spc   "Retail W"
       ThrmlZnRef = "Retail W ThrmlZn"
       Area = 1120
       ..

Rules:
  - First line is always "RulesetFilename <quoted string>" with no body / no terminator.
  - Every other record is: <TypeIdent>  "<Name>" then indented "key = value" lines,
    terminated by a line containing only "..".
  - Values are: quoted strings, bare numbers, or parenthesized comma-separated lists
    of the above (arrays can wrap across multiple physical lines - whitespace/newlines
    are not significant).
  - Keys can be indexed: "PVWAzm[1] = 170".
  - Records reference each other by name via *Ref keys (e.g. ThrmlZnRef, ConsAssmRef).

This module tokenizes the whole file and parses it structurally, so it round-trips
correctly regardless of the original line-wrapping / whitespace.
"""

import re
import sys
import json
import glob
import argparse
from collections import OrderedDict


def read_cibd(path):
    """.cibd25 files are usually UTF-8 (sometimes with a BOM), but some CEC-authored
    files contain stray Windows-1252 bytes (e.g. superscript footnote markers). Try
    UTF-8 first, fall back to cp1252 so we never crash on a real project file."""
    with open(path, "rb") as f:
        raw = f.read()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252")

TOKEN_RE = re.compile(r"""
    (?P<WS>\s+)
  | (?P<STRING>"(?:[^"\\]|\\.)*")
  | (?P<DOTDOT>\.\.(?=\s|$))
  | (?P<NUMBER>-?\d+\.?\d*(?:[eE][+-]?\d+)?)
  | (?P<LPAREN>\()
  | (?P<RPAREN>\))
  | (?P<LBRACK>\[)
  | (?P<RBRACK>\])
  | (?P<EQUALS>=)
  | (?P<COMMA>,)
  | (?P<IDENT>[A-Za-z_][A-Za-z0-9_.]*)
""", re.VERBOSE)


def tokenize(text):
    tokens = []
    pos = 0
    length = len(text)
    while pos < length:
        m = TOKEN_RE.match(text, pos)
        if not m:
            raise SyntaxError(f"Unexpected character {text[pos]!r} at offset {pos}")
        kind = m.lastgroup
        val = m.group()
        pos = m.end()
        if kind == "WS":
            continue
        tokens.append((kind, val))
    return tokens


def unquote(s):
    inner = s[1:-1]
    return inner.replace('\\"', '"').replace("\\\\", "\\")


def quote(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


class Record:
    def __init__(self, rtype, name):
        self.type = rtype
        self.name = name
        self.attrs = OrderedDict()  # key -> scalar/list, OR key -> {index: value}

    def set(self, key, value, index=None):
        if index is None:
            self.attrs[key] = value
        else:
            cur = self.attrs.get(key)
            if not isinstance(cur, dict):
                cur = {}
                self.attrs[key] = cur
            cur[index] = value

    def get(self, key, index=None, default=None):
        val = self.attrs.get(key, default)
        if index is not None and isinstance(val, dict):
            return val.get(index, default)
        return val

    def __repr__(self):
        return f"<Record {self.type} {self.name!r} ({len(self.attrs)} attrs)>"


class Document:
    def __init__(self, ruleset_filename, records):
        self.ruleset_filename = ruleset_filename
        self.records = records

    def find(self, rtype=None, name=None):
        out = []
        for r in self.records:
            if rtype is not None and r.type != rtype:
                continue
            if name is not None and r.name != name:
                continue
            out.append(r)
        return out

    def types_summary(self):
        counts = OrderedDict()
        for r in self.records:
            counts[r.type] = counts.get(r.type, 0) + 1
        return counts


def _parse_value(tokens, i):
    kind, val = tokens[i]
    if kind == "LPAREN":
        i += 1
        items = []
        while tokens[i][0] != "RPAREN":
            v, i = _parse_value(tokens, i)
            items.append(v)
            if tokens[i][0] == "COMMA":
                i += 1
        i += 1  # consume RPAREN
        return items, i
    elif kind == "STRING":
        return unquote(val), i + 1
    elif kind == "NUMBER":
        num = float(val) if ("." in val or "e" in val.lower()) else int(val)
        return num, i + 1
    else:
        # Fallback: treat bare identifier as a literal string token
        return val, i + 1


def parse(text):
    tokens = tokenize(text)
    i = 0
    n = len(tokens)

    assert tokens[i][0] == "IDENT", "Expected RulesetFilename header"
    i += 1
    ruleset_filename = None
    if i < n and tokens[i][0] == "STRING":
        ruleset_filename = unquote(tokens[i][1])
        i += 1

    records = []
    while i < n:
        kind, val = tokens[i]
        if kind != "IDENT":
            i += 1
            continue
        rtype = val
        i += 1
        if i >= n or tokens[i][0] != "STRING":
            # Not a real record header, skip
            continue
        rname = unquote(tokens[i][1])
        i += 1
        rec = Record(rtype, rname)

        while i < n and tokens[i][0] != "DOTDOT":
            kkind, kval = tokens[i]
            if kkind != "IDENT":
                i += 1
                continue
            key = kval
            i += 1
            index = None
            if i < n and tokens[i][0] == "LBRACK":
                i += 1
                index = int(tokens[i][1])
                i += 1
                assert tokens[i][0] == "RBRACK"
                i += 1
            assert tokens[i][0] == "EQUALS", f"Expected '=' after key {key}"
            i += 1
            value, i = _parse_value(tokens, i)
            rec.set(key, value, index)

        if i < n and tokens[i][0] == "DOTDOT":
            i += 1
        records.append(rec)

    return Document(ruleset_filename, records)


def _format_value(v):
    if isinstance(v, str):
        return quote(v)
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    if isinstance(v, list):
        return "( " + ", ".join(_format_value(x) for x in v) + " )"
    return str(v)


def serialize(doc):
    out = [f"RulesetFilename   {quote(doc.ruleset_filename)}  \r\n\r\n"]
    for rec in doc.records:
        out.append(f"{rec.type}   {quote(rec.name)}  \r\n")
        for key, value in rec.attrs.items():
            if isinstance(value, dict):
                for idx in sorted(value.keys()):
                    out.append(f"   {key}[{idx}] = {_format_value(value[idx])}\r\n")
            else:
                out.append(f"   {key} = {_format_value(value)}\r\n")
        out.append("   ..\r\n\r\n")
    out.append("END_OF_FILE\r\n")
    return "".join(out)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def cmd_inspect(args):
    doc = parse(read_cibd(args.file))
    print(f"RulesetFilename: {doc.ruleset_filename}")
    print(f"Total records: {len(doc.records)}")
    print("By type:")
    for t, c in doc.types_summary().items():
        print(f"  {t:20s} {c}")
    if args.type:
        matches = doc.find(rtype=args.type, name=args.name)
        for rec in matches:
            print(f"\n{rec.type} {rec.name!r}:")
            for k, v in rec.attrs.items():
                print(f"  {k} = {v!r}")


def cmd_batch_edit(args):
    with open(args.edits, "r") as f:
        spec = json.load(f)
    edits = spec["edits"]

    files = []
    for pattern in args.files:
        files.extend(glob.glob(pattern))
    if not files:
        print("No input files matched.", file=sys.stderr)
        sys.exit(1)

    import os
    if args.out_dir:
        os.makedirs(args.out_dir, exist_ok=True)

    for path in files:
        text = read_cibd(path)
        doc = parse(text)

        changed = []
        for edit in edits:
            rtype = edit.get("record_type")
            rname = edit.get("record_name")  # None = apply to all records of rtype
            key = edit["key"]
            index = edit.get("index")
            new_value = edit["value"]

            targets = doc.find(rtype=rtype, name=rname) if rname else doc.find(rtype=rtype)
            for rec in targets:
                old_value = rec.get(key, index=index)
                if old_value != new_value:
                    rec.set(key, new_value, index=index)
                    changed.append((rec.type, rec.name, key, index, old_value, new_value))

        if args.dry_run:
            print(f"\n=== {path} ===")
            if not changed:
                print("  (no changes)")
            for rtype_, rname_, key_, idx_, old_, new_ in changed:
                idx_str = f"[{idx_}]" if idx_ is not None else ""
                print(f"  {rtype_} {rname_!r}.{key_}{idx_str}: {old_!r} -> {new_!r}")
        else:
            out_text = serialize(doc)
            if args.out_dir:
                import os
                out_path = os.path.join(args.out_dir, os.path.basename(path))
            else:
                out_path = path
            with open(out_path, "w", encoding="utf-8", newline="") as f:
                f.write(out_text)
            print(f"{path}: {len(changed)} value(s) changed -> {out_path}")


def main():
    ap = argparse.ArgumentParser(description="Parse/edit CBECC .cibd25 project files")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_inspect = sub.add_parser("inspect", help="Summarize a file, optionally drill into a record type")
    p_inspect.add_argument("file")
    p_inspect.add_argument("--type", help="Record type to list in detail, e.g. Spc")
    p_inspect.add_argument("--name", help="Restrict to a specific record name")
    p_inspect.set_defaults(func=cmd_inspect)

    p_batch = sub.add_parser("batch-edit", help="Apply a JSON edit spec across one or more files")
    p_batch.add_argument("files", nargs="+", help="Input file(s) or glob pattern(s)")
    p_batch.add_argument("--edits", required=True, help="Path to JSON edit spec")
    p_batch.add_argument("--out-dir", help="Write edited copies here instead of overwriting")
    p_batch.add_argument("--dry-run", action="store_true", help="Show what would change, write nothing")
    p_batch.set_defaults(func=cmd_batch_edit)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
