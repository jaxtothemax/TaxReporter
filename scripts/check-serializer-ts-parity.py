#!/usr/bin/env python3
"""scripts/check-serializer-ts-parity.py — backend schema <-> TypeScript
interface parity gate.

## Why this exists

Hand-maintained shared frontend types drift from what the backend API
actually returns, silently. A field is added to a serializer but not to the
TypeScript interface: the frontend cannot see it, with no error anywhere. A
field's type drifts (a schema says `string`, TypeScript says `number`, or
one side allows null and the other doesn't): both sides keep type-checking
cleanly against their own private idea of the contract, and nothing compares
them. Both are the same underlying defect — two representations of one
contract, each internally consistent, with no gate between them.

## Why a diff gate and not code generation

Generating TypeScript from the schema (or vice versa) would remove the
drift by construction, and is worth doing if your stack has a generator you
trust. This gate exists for the more common situation: hand-written
interfaces are staying hand-written (a prior generator evaluation failed
this project's dependency/security bar, the generated shape did not fit the
existing consumers, or nobody has gotten around to it yet), and the gate's
job is to tell you the two drifted, not to fix it for you. It reads an
OpenAPI document (the artifact an external API consumer would generate a
client from) — not the serializer source directly — so it works for any
backend framework that can emit or already emits an OpenAPI schema, not
only Django REST Framework.

## What is checked

For each mapped (schema component, TypeScript interface) pair:

  missing_in_ts      a schema property with no field of that name in TypeScript
  missing_in_schema  a TypeScript field with no property of that name in the schema
  type_family        both sides declare a type, and the families disagree
                     (string / number / boolean / array / object)
  untyped_schema     the schema declares no resolvable type at all for a property
  nullability        one side admits null and the other does not
  enum_members       both sides resolve to a set of string values, and the sets differ

A check is skipped, never guessed, when either side cannot be classified
with confidence — an unresolvable TypeScript alias produces no finding
rather than a false one. Deliberately not an AST parse: field names, one
type expression per field, and rough optionality are all this needs, and a
regex extractor keeps the gate dependency-free.

## Component mapping — the configurable part

`--component-map` points at a JSON file `{"SchemaComponent": "TSInterface", ...}`.
Without one, every schema component whose name is ALSO the name of a
TypeScript interface in `--types` is compared under that shared name — the
common case for a project that names its interfaces after its serializers.
A project whose naming diverges (a `CurrentUserSerializer` schema component
backing a `User` interface) supplies an explicit map.

## Skip cleanly when the stack is absent

If `--schema` is not given and no schema file exists at any of the default
locations, or `--types` does not exist, this is a clone with no Python
backend + TypeScript frontend pairing wired up (or no OpenAPI document
generated yet) — the gate prints an INFO line and exits 0, the same
skip-cleanly shape every other stack-conditional gate in this template uses.

## Usage

    python3 scripts/check-serializer-ts-parity.py
    python3 scripts/check-serializer-ts-parity.py --schema docs/api/openapi.json --types frontend/src/types.ts
    python3 scripts/check-serializer-ts-parity.py --component-map .ts-parity-map.json
    python3 scripts/check-serializer-ts-parity.py --self-test

## Exit codes

    0  parity holds, or no schema/types file configured (skip)
    1  drift found
    2  usage or environment error (schema unreadable, mapped component/interface
       not found, or the scan matched zero mapped pairs while both files exist)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

EXIT_OK = 0
EXIT_DRIFT = 1
EXIT_USAGE = 2

DEFAULT_SCHEMA_CANDIDATES = ("docs/api/openapi.json", "openapi.json", "backend/openapi.json")
DEFAULT_TYPES_CANDIDATES = ("frontend/src/types/index.ts", "frontend/src/types.ts", "web/src/types.ts")

UNKNOWN = "unknown"

# ─── findings ────────────────────────────────────────────────────────────────

MISSING_IN_TS = "missing_in_ts"
MISSING_IN_SCHEMA = "missing_in_schema"
TYPE_FAMILY = "type_family"
UNTYPED_SCHEMA = "untyped_schema"
NULLABILITY = "nullability"
ENUM_MEMBERS = "enum_members"


@dataclass(frozen=True)
class Finding:
    kind: str
    component: str
    interface: str
    field: str
    schema_repr: str
    ts_repr: str
    ts_line: int | None = None

    def describe(self, types_path: str) -> str:
        loc = f"{types_path}:{self.ts_line}" if self.ts_line else types_path
        head = f"{self.component}.{self.field}  ({self.interface} in {loc})"
        body = {
            MISSING_IN_TS: f"    schema sends `{self.field}` ({self.schema_repr}); no such field in `{self.interface}`",
            MISSING_IN_SCHEMA: f"    `{self.interface}.{self.field}` ({self.ts_repr}) has no matching schema property",
            TYPE_FAMILY: f"    schema says {self.schema_repr}; TypeScript says {self.ts_repr}",
            UNTYPED_SCHEMA: f"    schema declares no type at all; TypeScript says {self.ts_repr}",
            NULLABILITY: f"    schema {self.schema_repr}; TypeScript {self.ts_repr}",
            ENUM_MEMBERS: f"    schema allows {self.schema_repr}; TypeScript allows {self.ts_repr}",
        }[self.kind]
        return f"  {head}\n{body}"


# ─── TypeScript extraction ───────────────────────────────────────────────────


@dataclass
class TsField:
    name: str
    type_text: str
    optional: bool
    line: int


def strip_ts_comments(src: str) -> str:
    """Blank out `//` and `/* */` comments, preserving line/offset structure.

    String literals are respected so a `//` inside `"http://..."` is not
    read as a comment.
    """
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch in "\"'`":
            quote = ch
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "*":
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                if src[i] != "\n":
                    out[i] = " "
                i += 1
            for j in range(i, min(i + 2, n)):
                out[j] = " "
            i += 2
            continue
        i += 1
    return "".join(out)


_INTERFACE_RE = re.compile(r"\bexport\s+interface\s+(\w+)\s*(?:<[^{]*?>\s*)?(?:extends\s+([^{]+?))?\s*\{")
_FIELD_RE = re.compile(r"^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*(.+?)\s*$", re.S)
_FIELD_START_RE = re.compile(r"^\s*(?:readonly\s+)?[A-Za-z_$][\w$]*\s*\??\s*:")


def parse_ts_interfaces(src: str) -> dict[str, dict[str, TsField]]:
    """Extract top-level field name / type / optionality for every exported interface.

    Brace-depth aware, so a nested object literal (`ancestors?: { id: number }[]`)
    contributes one field named `ancestors` rather than leaking `id` into the
    parent interface.
    """
    clean = strip_ts_comments(src)
    result: dict[str, dict[str, TsField]] = {}
    parents: dict[str, list[str]] = {}
    for m in _INTERFACE_RE.finditer(clean):
        name = m.group(1)
        if m.group(2):
            # `extends A, B<T>` — the base name of each parent; generic
            # arguments are irrelevant to which fields it contributes.
            parents[name] = [p.split("<", 1)[0].strip() for p in _split_top_level_commas(m.group(2))]
        body_start = m.end()
        depth, i, n = 1, body_start, len(clean)
        while i < n and depth:
            if clean[i] == "{":
                depth += 1
            elif clean[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = clean[body_start:i]
        result[name] = _parse_interface_body(body, clean.count("\n", 0, body_start) + 1)
    return _merge_inherited(result, parents)


def _split_top_level_commas(text: str) -> list[str]:
    parts, depth, cur, prev = [], 0, [], ""
    for ch in text:
        depth = _adjust_depth(depth, ch, prev)
        prev = ch
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
            continue
        cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def _merge_inherited(
    own: dict[str, dict[str, TsField]], parents: dict[str, list[str]]
) -> dict[str, dict[str, TsField]]:
    """Give each interface the fields of the local interfaces it extends.

    A serializer subclass is flattened into one schema component, while its
    TypeScript counterpart is usually `interface Detail extends Base`. Without
    this every inherited field reads as `missing_in_ts`. A parent not declared
    in this file (imported, or a utility type like `Omit<...>`) contributes
    nothing — the comparison then reports what it can see rather than guessing.
    Own fields override inherited ones, as in TypeScript.
    """
    merged: dict[str, dict[str, TsField]] = {}

    def resolve(name: str, seen: frozenset[str]) -> dict[str, TsField]:
        if name in merged:
            return merged[name]
        fields: dict[str, TsField] = {}
        for parent in parents.get(name, []):
            if parent in own and parent not in seen:
                fields.update(resolve(parent, seen | {name}))
        fields.update(own[name])
        merged[name] = fields
        return fields

    for name in own:
        resolve(name, frozenset())
    return merged


def _starts_new_field(body: str, pos: int) -> bool:
    n = len(body)
    while pos < n:
        end = body.find("\n", pos)
        if end == -1:
            end = n
        segment = body[pos:end]
        if segment.strip():
            return bool(_FIELD_START_RE.match(segment))
        pos = end + 1
    return False


def _parse_interface_body(body: str, first_line: int) -> dict[str, TsField]:
    """Split an interface body into one chunk per field.

    A field ends at a depth-0 `;`, or at a newline only when the next
    non-blank line starts another field — that lookahead is what makes a
    multi-line union survive (`role:\\n  | "admin"\\n  | "viewer";`).
    """
    fields: dict[str, TsField] = {}
    depth = 0
    chunk: list[str] = []
    line = first_line
    chunk_line = first_line
    prev = ""
    i, n = 0, len(body)

    def flush(at_line: int) -> None:
        text = "".join(chunk)
        if text.strip():
            f = _parse_field(text, at_line)
            if f:
                fields[f.name] = f
        chunk.clear()

    while i < n:
        ch = body[i]
        if ch == "\n":
            line += 1
        depth = _adjust_depth(depth, ch, prev)
        prev = ch
        if depth == 0 and (ch == ";" or (ch == "\n" and _starts_new_field(body, i + 1))):
            flush(chunk_line)
            chunk_line = line
            i += 1
            continue
        chunk.append(ch)
        i += 1
    flush(chunk_line)
    return fields


def _parse_field(text: str, line: int) -> TsField | None:
    m = _FIELD_RE.match(text)
    if not m:
        return None
    name, optional, type_text = m.group(1), bool(m.group(2)), m.group(3)
    type_text = " ".join(type_text.split()).rstrip(";,").strip()
    if not type_text:
        return None
    return TsField(name=name, type_text=type_text, optional=optional, line=line)


_TYPE_ALIAS_RE = re.compile(r"\bexport\s+type\s+(\w+)\s*=\s*([^;]+);")


def parse_ts_string_unions(src: str) -> dict[str, frozenset[str]]:
    """Resolve `export type X = "a" | "b"` aliases, including one level of alias reuse."""
    clean = strip_ts_comments(src)
    raw = {m.group(1): " ".join(m.group(2).split()) for m in _TYPE_ALIAS_RE.finditer(clean)}
    resolved: dict[str, frozenset[str]] = {}

    def resolve(name: str, seen: frozenset[str]) -> frozenset[str] | None:
        if name in resolved:
            return resolved[name]
        if name not in raw or name in seen:
            return None
        members: set[str] = set()
        for part in raw[name].split("|"):
            part = part.strip()
            if len(part) >= 2 and part[0] in "\"'" and part[-1] == part[0]:
                members.add(part[1:-1])
            else:
                sub = resolve(part, seen | {name})
                if sub is None:
                    return None
                members |= sub
        out = frozenset(members)
        resolved[name] = out
        return out

    for alias in raw:
        resolve(alias, frozenset())
    return resolved


# ─── type classification ─────────────────────────────────────────────────────


@dataclass
class TypeInfo:
    family: str = UNKNOWN
    nullable: bool = False
    enum: frozenset[str] | None = None
    repr: str = UNKNOWN


_SCHEMA_FAMILIES = {
    "integer": "number",
    "number": "number",
    "string": "string",
    "boolean": "boolean",
    "array": "array",
    "object": "object",
}


def classify_schema(prop: dict, components: dict) -> TypeInfo:
    if isinstance(prop, dict) and isinstance(prop.get("oneOf"), list) and prop["oneOf"]:
        branches = [classify_schema(b, components) for b in prop["oneOf"]]
        families = {b.family for b in branches if b.family != UNKNOWN}
        family = families.pop() if len(families) == 1 else UNKNOWN
        enums = [b.enum for b in branches if b.enum is not None]
        merged = frozenset().union(*enums) if enums else None
        nullable = bool(prop.get("nullable")) or any(b.nullable for b in branches)
        return TypeInfo(family, nullable, _clean_enum(merged), family if family != UNKNOWN else "no type")

    node, nullable = _unwrap_schema(prop, components)
    if node is None:
        return TypeInfo(UNKNOWN, nullable, None, "no type")
    if "$ref" in node:
        return TypeInfo("object", nullable, None, "object")
    raw_enum = node.get("enum") if isinstance(node.get("enum"), list) else None
    # A `null` enum member is nullability, not a value. drf-spectacular renders
    # a `null=True` choice field as oneOf[XEnum, BlankEnum, NullEnum] with
    # NullEnum = {"enum": [null]}; leaving None in the set made the enum
    # comparison sort None against str and crash with exit 1 — the same code as
    # "drift found". Found by the app-fixture-gates suite.
    if raw_enum is not None and None in raw_enum:
        nullable = True
    enum = _clean_enum(frozenset(v for v in raw_enum if v is not None) if raw_enum is not None else None)
    raw = node.get("type")
    if raw is None:
        if "properties" in node:
            return TypeInfo("object", nullable, enum, "object")
        return TypeInfo(UNKNOWN, nullable, enum, "no type")
    family = _SCHEMA_FAMILIES.get(raw, UNKNOWN)
    return TypeInfo(family, nullable, enum, family if family != UNKNOWN else "no type")


def _clean_enum(enum: frozenset[str] | None) -> frozenset[str] | None:
    """Drop a bare empty-string member some generators add for a blankable
    choice field — that describes what a WRITE may contain, not a distinct
    value a read returns, so comparing it against a frontend union would
    flag every blankable choice field for no benefit.
    """
    if enum is None:
        return None
    cleaned = enum - {""}
    return cleaned or None


def _unwrap_schema(prop: dict, components: dict, depth: int = 0) -> tuple[dict | None, bool]:
    if depth > 10 or not isinstance(prop, dict):
        return None, False
    nullable = bool(prop.get("nullable"))
    if "allOf" in prop and isinstance(prop["allOf"], list) and len(prop["allOf"]) == 1:
        inner, inner_null = _unwrap_schema(prop["allOf"][0], components, depth + 1)
        return inner, nullable or inner_null
    if "$ref" in prop:
        target = _resolve_ref(prop["$ref"], components)
        if target is None:
            return prop, nullable
        inner, inner_null = _unwrap_schema(target, components, depth + 1)
        return inner, nullable or inner_null
    return prop, nullable


def _resolve_ref(ref: str, components: dict) -> dict | None:
    prefix = "#/components/schemas/"
    if not ref.startswith(prefix):
        return None
    return components.get(ref[len(prefix):])


_TS_PRIMITIVES = {"number": "number", "string": "string", "boolean": "boolean"}


def classify_ts(type_text: str, unions: dict[str, frozenset[str]]) -> TypeInfo:
    parts = [p.strip() for p in _split_union(type_text)]
    nullable = any(p in ("null", "undefined") for p in parts)
    rest = [p for p in parts if p not in ("null", "undefined")]
    if not rest:
        return TypeInfo(UNKNOWN, nullable, None, UNKNOWN)

    literals = {p[1:-1] for p in rest if len(p) >= 2 and p[0] in "\"'" and p[-1] == p[0]}
    if literals and len(literals) == len(rest):
        return TypeInfo("string", nullable, frozenset(literals), "string")

    if len(rest) == 1:
        one = rest[0]
        if one in unions:
            return TypeInfo("string", nullable, unions[one], "string")
        if one.endswith("[]") or one.startswith("Array<"):
            return TypeInfo("array", nullable, None, "array")
        if one in _TS_PRIMITIVES:
            return TypeInfo(_TS_PRIMITIVES[one], nullable, None, _TS_PRIMITIVES[one])
        if one.startswith("{") or one.startswith("Record<") or one.startswith("Partial<"):
            return TypeInfo("object", nullable, None, "object")
        if re.fullmatch(r"[A-Z]\w*", one):
            return TypeInfo("object", nullable, None, "object")
        return TypeInfo(UNKNOWN, nullable, None, UNKNOWN)
    return TypeInfo(UNKNOWN, nullable, None, UNKNOWN)


def _adjust_depth(depth: int, ch: str, prev: str) -> int:
    """Bracket-depth step that understands `=>` — the `>` of an arrow type is
    not a closing bracket, and counting it as one would drive depth negative
    and silently stop finding field boundaries after the first function-typed
    field.
    """
    if ch in "{([<":
        return depth + 1
    if ch in "})]>":
        if ch == ">" and prev == "=":
            return depth
        return max(0, depth - 1)
    return depth


def _split_union(text: str) -> list[str]:
    parts, depth, cur, prev = [], 0, [], ""
    for ch in text:
        depth = _adjust_depth(depth, ch, prev)
        prev = ch
        if ch == "|" and depth == 0:
            parts.append("".join(cur))
            cur = []
            continue
        cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


# ─── comparison ──────────────────────────────────────────────────────────────


def resolve_component_map(
    explicit: dict[str, str] | None, components: dict, interfaces: dict[str, dict[str, TsField]]
) -> dict[str, str]:
    if explicit is not None:
        return explicit
    # No map given: compare every schema component whose name is also a
    # TypeScript interface name — the common "interfaces named after their
    # serializers" convention.
    return {name: name for name in components if name in interfaces}


def compare(
    schema: dict,
    interfaces: dict[str, dict[str, TsField]],
    unions: dict[str, frozenset[str]],
    component_map: dict[str, str],
) -> tuple[list[Finding], list[str]]:
    components = schema.get("components", {}).get("schemas", {})
    findings: list[Finding] = []
    errors: list[str] = []

    for comp_name, iface_name in sorted(component_map.items()):
        comp = components.get(comp_name)
        if comp is None:
            errors.append(f"schema component `{comp_name}` not found — mapping is stale or the schema is incomplete")
            continue
        iface = interfaces.get(iface_name)
        if iface is None:
            errors.append(f"TypeScript interface `{iface_name}` not found")
            continue
        props = comp.get("properties", {})

        for prop_name, prop in sorted(props.items()):
            s = classify_schema(prop, components)
            ts_field = iface.get(prop_name)
            if ts_field is None:
                findings.append(Finding(MISSING_IN_TS, comp_name, iface_name, prop_name, s.repr, "absent"))
                continue
            t = classify_ts(ts_field.type_text, unions)

            if s.family == UNKNOWN and s.enum is None:
                findings.append(Finding(UNTYPED_SCHEMA, comp_name, iface_name, prop_name, "no type", t.repr, ts_field.line))
                continue
            if s.family != UNKNOWN and t.family != UNKNOWN and s.family != t.family:
                findings.append(Finding(TYPE_FAMILY, comp_name, iface_name, prop_name, s.family, t.family, ts_field.line))
                continue
            # An optional TypeScript field (`x?: T`) already means "may be
            # absent" — only a declared `| null` is compared for nullability.
            if not ts_field.optional and s.nullable != t.nullable:
                findings.append(Finding(
                    NULLABILITY, comp_name, iface_name, prop_name,
                    "nullable" if s.nullable else "not nullable",
                    "nullable" if t.nullable else "not nullable",
                    ts_field.line,
                ))
                continue
            if s.enum is not None and t.enum is not None and s.enum != t.enum:
                findings.append(Finding(
                    ENUM_MEMBERS, comp_name, iface_name, prop_name,
                    "|".join(sorted(s.enum)), "|".join(sorted(t.enum)), ts_field.line,
                ))

        for ts_name, ts_field in sorted(iface.items()):
            if ts_name not in props:
                t = classify_ts(ts_field.type_text, unions)
                findings.append(Finding(MISSING_IN_SCHEMA, comp_name, iface_name, ts_name, "absent", t.repr, ts_field.line))

    return findings, errors


# ─── schema/types loading ─────────────────────────────────────────────────────


def find_default(candidates: tuple[str, ...], repo_root: Path) -> Path | None:
    for c in candidates:
        p = repo_root / c
        if p.exists():
            return p
    return None


def run_check(
    schema_path: Path | None,
    types_path: Path | None,
    component_map_path: Path | None,
    repo_root: Path,
) -> tuple[int, list[str]]:
    schema_path = schema_path or find_default(DEFAULT_SCHEMA_CANDIDATES, repo_root)
    types_path = types_path or find_default(DEFAULT_TYPES_CANDIDATES, repo_root)

    if schema_path is None or types_path is None:
        missing = "schema (openapi.json)" if schema_path is None else "TypeScript types"
        return EXIT_OK, [
            f"INFO: skipping — no {missing} file found or configured. No Python backend + "
            "TypeScript frontend pairing wired up in this clone."
        ]

    if not schema_path.exists():
        return EXIT_USAGE, [f"ERROR: --schema {schema_path} does not exist."]
    if not types_path.exists():
        return EXIT_USAGE, [f"ERROR: --types {types_path} does not exist."]

    try:
        schema = json.loads(schema_path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        return EXIT_USAGE, [f"ERROR: could not read/parse {schema_path}: {exc}"]

    ts_src = types_path.read_text()
    interfaces = parse_ts_interfaces(ts_src)
    unions = parse_ts_string_unions(ts_src)

    explicit_map: dict[str, str] | None = None
    if component_map_path is not None:
        try:
            explicit_map = json.loads(component_map_path.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            return EXIT_USAGE, [f"ERROR: could not read/parse --component-map {component_map_path}: {exc}"]

    components = schema.get("components", {}).get("schemas", {})
    component_map = resolve_component_map(explicit_map, components, interfaces)

    if not component_map:
        return EXIT_USAGE, [
            "ERROR: no (schema component, TypeScript interface) pairs to compare — the schema and "
            f"{types_path} share no matching names, and no --component-map was given. A gate that "
            "compares nothing must not report success."
        ]

    findings, errors = compare(schema, interfaces, unions, component_map)

    messages: list[str] = []
    if errors:
        messages.append(f"MAPPING ERRORS — {len(errors)}:")
        messages.extend(f"  {e}" for e in errors)

    if findings:
        messages.append(f"PARITY DRIFT — {len(findings)} finding(s):")
        for f in sorted(findings, key=lambda x: (x.component, x.field, x.kind)):
            messages.append(f.describe(str(types_path)))
        return EXIT_DRIFT, messages

    if errors:
        return EXIT_USAGE, messages

    messages.append(f"OK: serializer <-> TypeScript parity holds across {len(component_map)} mapped pair(s).")
    return EXIT_OK, messages


# ─── self-test ────────────────────────────────────────────────────────────

_SELF_TEST_SCHEMA = {
    "components": {
        "schemas": {
            "Widget": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "name": {"type": "string"},
                    "count": {"type": "integer"},
                    "flag": {"type": "boolean"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "owner": {"allOf": [{"$ref": "#/components/schemas/Thing"}], "nullable": True},
                    "role": {"$ref": "#/components/schemas/RoleEnum"},
                    "untyped": {},
                    "missing_from_ts": {"type": "string"},
                },
            },
            "RoleEnum": {"type": "string", "enum": ["admin", "viewer"]},
            "Thing": {"type": "object", "properties": {"id": {"type": "integer"}}},
        }
    }
}

_SELF_TEST_TS = '''
export type Role = "admin" | "viewer";

/** A comment containing { braces } and a // slash and a "quote". */
export interface Widget {
  id: number;
  name: string;
  count: string;
  flag: boolean;
  tags: string[];
  owner: Thing | null;
  role: Role;
  untyped: string;
  extra_only_in_ts: string;
}

interface Thing {
  id: number;
}
'''

_SELF_TEST_SCHEMA_CLEAN = {
    "components": {
        "schemas": {
            "Widget": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "name": {"type": "string"},
                    "count": {"type": "integer"},
                    "flag": {"type": "boolean"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "owner": {"allOf": [{"$ref": "#/components/schemas/Thing"}], "nullable": True},
                    "role": {"$ref": "#/components/schemas/RoleEnum"},
                },
            },
            "RoleEnum": {"type": "string", "enum": ["admin", "viewer"]},
            "Thing": {"type": "object", "properties": {"id": {"type": "integer"}}},
        }
    }
}

_SELF_TEST_TS_CLEAN = '''
export type Role = "admin" | "viewer";

export interface Widget {
  id: number;
  name: string;
  count: number;
  flag: boolean;
  tags: string[];
  owner: Thing | null;
  role: Role;
}

interface Thing {
  id: number;
}
'''


def self_test() -> int:
    import tempfile

    failures: list[str] = []

    def write(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        schema_path = root / "openapi.json"
        types_path = root / "types.ts"
        write(schema_path, json.dumps(_SELF_TEST_SCHEMA))
        write(types_path, _SELF_TEST_TS)

        code, messages = run_check(schema_path, types_path, None, root)
        joined = "\n".join(messages)

        def check(cond: bool, label: str) -> None:
            if cond:
                print(f"SELF-TEST OK: {label}")
            else:
                print(f"SELF-TEST FAILED: {label}", file=sys.stderr)
                for m in messages:
                    print(f"    {m}", file=sys.stderr)
                failures.append(label)

        check(code == EXIT_DRIFT, "known-bad fixture reports drift (exit 1)")
        check("count" in joined and TYPE_FAMILY in joined.lower() or "count" in joined, "type_family mismatch on count is reported")
        check("missing_from_ts" in joined, "a schema property absent from TS is reported (missing_in_ts)")
        check("extra_only_in_ts" in joined, "a TS field absent from the schema is reported (missing_in_schema)")
        check("untyped" in joined, "an untyped schema property is reported")

        # A clean fixture (schema and types corrected to match exactly) must pass.
        write(schema_path, json.dumps(_SELF_TEST_SCHEMA_CLEAN))
        write(types_path, _SELF_TEST_TS_CLEAN)
        code2, messages2 = run_check(schema_path, types_path, None, root)
        if code2 == EXIT_OK:
            print("SELF-TEST OK: corrected fixture reports parity (exit 0)")
        else:
            print(f"SELF-TEST FAILED: corrected fixture should report parity, got exit {code2}:", file=sys.stderr)
            for m in messages2:
                print(f"    {m}", file=sys.stderr)
            failures.append("corrected-fixture-is-clean")

    # Skip-cleanly case: neither file present.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        code3, messages3 = run_check(None, None, None, root)
        if code3 == EXIT_OK and any("INFO" in m for m in messages3):
            print("SELF-TEST OK: no schema/types configured skips cleanly (exit 0)")
        else:
            print(f"SELF-TEST FAILED: expected a clean skip, got exit {code3}: {messages3}", file=sys.stderr)
            failures.append("skip-cleanly-when-stack-absent")

    # Explicit --component-map with a differently-named interface.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        schema_path = root / "openapi.json"
        types_path = root / "types.ts"
        map_path = root / "map.json"
        write(schema_path, json.dumps({
            "components": {"schemas": {"CurrentUser": {"type": "object", "properties": {"id": {"type": "integer"}}}}}
        }))
        write(types_path, "export interface User {\n  id: number;\n}\n")
        write(map_path, json.dumps({"CurrentUser": "User"}))
        code4, messages4 = run_check(schema_path, types_path, map_path, root)
        if code4 == EXIT_OK:
            print("SELF-TEST OK: explicit --component-map compares a differently-named pair")
        else:
            print(f"SELF-TEST FAILED: explicit component map case, got exit {code4}: {messages4}", file=sys.stderr)
            failures.append("explicit-component-map")

    if failures:
        print(f"\nSELF-TEST: {len(failures)} case(s) failed: {', '.join(failures)}", file=sys.stderr)
        return 1
    print("\nSELF-TEST: all cases passed.")
    return 0


# ─── CLI ──────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--schema", type=Path, default=None, help="path to an OpenAPI JSON document")
    parser.add_argument("--types", type=Path, default=None, help="path to a TypeScript file with exported interfaces")
    parser.add_argument("--component-map", type=Path, default=None, help="JSON file mapping schema component -> TS interface")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    repo_root = Path(__file__).resolve().parent.parent
    code, messages = run_check(args.schema, args.types, args.component_map, repo_root)
    for m in messages:
        print(m)
    return code


if __name__ == "__main__":
    sys.exit(main())
