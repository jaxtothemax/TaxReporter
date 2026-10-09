# 14. XLSX import

**Date:** 2026-10-09
**Status:** Proposed

> **Implementation status (2026-10-09):** being built on branch `feat/xlsx-reader`, not yet on
> `main`. The DEFLATE decoder and CRC-32 (`packages/brokers/src/{inflate,crc32}.ts`) are in;
> the ZIP reader, the OOXML profile and the workbook reader are not yet.

## Context

The most used broker among Slovenian investors, eToro, exports only XLSX, as do XTB and Saxo
(research 07 §2). An XLSX file is a ZIP archive of XML parts. Intake refuses ZIP today
(`fileRefused`, reason `zip`). Reading XLSX opens three new trust boundaries at once: a ZIP
container, DEFLATE streams whose output is no longer bounded by the file's size, and XML
written by spreadsheet software rather than by a broker's exporter. On top of these come
spreadsheet semantics that can make the tool read different figures from the ones Excel shows
the user. A threat model on 2026-10-09 ranked the risks: ad-hoc number and date conversion
first, then a crafted file that Excel and TaxReporter read differently, then resource
exhaustion. It also recommended an own decoder over the `fflate` library. The decisions below
follow it, with the number and date rules sourced in research 09.

## Decision

1. **Our own ZIP reader and DEFLATE decoder**, no dependency, in `packages/brokers`.
   - `fflate`'s fixed-buffer mode silently drops output past the buffer and decodes on, never
     checks a stored block's NLEN, and its Node build spawns an eval'd worker.
   - The decoder (`inflate.ts`) refuses any stream a conforming encoder would not write: the
     list of rules is in the module.
   - It is differential-tested against Node's zlib, which only the tests use.
2. **A strict ZIP structure**, so that Excel and TaxReporter cannot read different archives
   from one file:
   - exactly one End of Central Directory record, ending at the end of the file;
   - the central directory directly before it; the entries' local records tiling the rest of
     the file in order, with no gap and no overlap;
   - each local header agreeing with its central entry;
   - every offset and length within the file;
   - no ZIP64, multi-disk or encrypted archive;
   - compression stored or DEFLATE only; for stored, compressed size equal to size;
   - general-purpose flags limited to the DEFLATE options, data descriptors (sizes taken from
     the central directory and checked against the descriptor) and UTF-8 names;
   - names of printable ASCII, at most 256 bytes, with no `\`, no leading `/` and no `..`
     segment; duplicates compared case-insensitively, as OPC does;
   - extra fields of at most 1 KiB, the ZIP64 one refused;
   - at most `LIMITS.zipEntries` entries, checked from the End of Central Directory record
     before the directory is parsed.
3. **A budget before any inflating.** Only the parts a workbook needs are inflated, and only
   when they are needed. Before the first, the declared sizes of the parts to read must fit
   `LIMITS.inflatedBytes`. Each part inflates to exactly its declared size and CRC-32, never a
   byte more. The CRC catches a decoder or a damaged part, not a file made to deceive: anyone
   can compute it.
4. **An OOXML profile of the strict XML scanner**, namespace-aware:
   - prefixes are resolved to namespace URIs (within a bound), and elements are matched by URI
     and local name, never by local name alone;
   - duplicate attributes are checked after resolution;
   - an element of a foreign namespace inside `sheetData` or `sst`, including
     `mc:AlternateContent`, is refused; outside them (`extLst` and the like) it is skipped
     whole;
   - text is allowed only in `v`, `t` and `f`; still no DOCTYPE, entity, CDATA or processing
     instruction; character references are allowed and checked, as XML needs `&#13;` to carry
     a CR;
   - one budget of elements and cells across all the parts of a file replaces the per-scan
     element cap, which counts the wrong unit for a sheet.
5. **The workbook, read through one choke point** (`readWorkbook`):
   - **Parts.** Sheet names and targets come from `workbook.xml` and its relationships,
     matched by relationship Type and resolved as OPC resolves them. Two sheets pointing at one
     part are refused, and an External target is never followed.
   - **Parts never inflated.** `docProps`, `customXml`, connections, external links,
     embeddings, VBA projects. An archive carrying a VBA project, or declaring a macro-enabled
     content type, is refused.
   - **Rows** are stored sparsely, never allocated from `r`, `dimension`, `spans` or `count`.
     A column past `LIMITS.columns`, a row past 1,048,576, a cell outside its row, a reference
     out of order or repeated, and an A1 reference of more than 3 letters or 7 digits, or with
     a leading zero, are refused.
   - **Shared strings.** Indices must be canonical and in range. A string's text is its runs
     joined, without phonetic (`rPh`) text, within `LIMITS.cellLength`. The text the cells make
     altogether, each shared-string use counted in full, is held to `LIMITS.fileBytes`
     characters, the bound a CSV already has.
   - **Cells.** Each is typed: string, number, boolean or error, with its stored text. A cell
     with a formula (`f`) in a sheet an adapter reads is refused, as brokers write no formulas
     and a cached value can differ from what Excel shows. An error cell blocks where an adapter
     reads its column.
   - **What is never read.** Merged cells are never expanded; styles, comments and data
     validation are never read.
   - **Sheets.** Names that repeat case-insensitively or exceed 31 characters are refused. A
     hidden sheet an adapter reads blocks.
   - **Sheets left unread.** A sheet no adapter reads is recorded as an ignored row with its
     own reason.
   - **Lookups.** Every lookup keyed by file text uses `Map` or `Object.hasOwn`.
6. **Errors and privacy.**
   - **Errors.** A refusal names a rule, a sheet's position and a cell reference, never a part
     name, a sheet name or a value; line numbers mean nothing in parts of one line.
   - **Reasons.** ZIP and XLSX reasons join `UnreadableReason`.
   - **Account IDs** go only into `accountScope`. The test suite plants a name in every part
     never read (the PII canaries), and checks it reaches no finding or key.
7. **Numbers: the cell's text, read exactly, rounded half up to 15 significant digits**
   (research 09 §1):
   - this gives back exactly the decimal a spreadsheet stored, and no more is there to
     recover;
   - the text must match an anchored grammar, its exponent bounded before it is expanded;
   - this one rounding undoes the binary representation at the reading of the cell, and is
     the exception to ADR 0006 that ADR 0011 left to this decision;
   - every later step stays exact.
8. **Dates: serials read in the workbook's own system** (research 09 §2):
   - `date1904` is read from `workbookPr`; absent, it means the 1900 system;
   - in the 1900 system, serials below 61 are refused (60 is the 29 February 1900 that never
     was);
   - the fraction becomes the time of day, rounded half up to the second, in exact
     arithmetic;
   - which clock a serial is in is each adapter's statement for its broker (ADR 0011 §7).
9. **New limits**, each tested at its value and one past it: `zipEntries` 256,
   `inflatedBytes` 64 MiB, `sheetsPerFile` 32, `cellsPerFile` 2,000,000 and `sharedStrings`
   1,000,000.
10. **Dispatch.** Intake recognizes a ZIP whose relationships name an SpreadsheetML workbook
    as the XLSX family, hands the workbook to the one XLSX adapter whose `matches` accepts it,
    and refuses any other ZIP as before. The dispatch line and the budget check are declared
    in `load-bearing.declarations`. The web app accepts `.xlsx` files.

## Consequences

- **Every broker after Trading 212 and IBKR that exports XLSX reuses this:** eToro first, then
  XTB and Saxo. An adapter sees typed rows by sheet, and states its own sheet names (a closed
  list per language and revision), header rows and clocks.
- **Edited files are refused, not read on a guess.** A user who opened a broker's export in
  Excel and saved it may meet a refusal; the message says to export it again, unchanged.
- **The number rule is an inference from sources,** to be checked against real exports before
  an adapter ships. A broker that writes a value of more than 15 significant digits would have
  it rounded; none is known to.
- **More code to own:** a ZIP reader and a decoder are new attack surface of our own. In
  exchange there is no dependency and one behavior in both apps, and the differential and
  fault tests keep the surface honest.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0014`
- [ ] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Record the count here, **including zero**.
