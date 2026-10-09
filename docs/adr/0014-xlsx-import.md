# 14. XLSX import

**Date:** 2026-10-09
**Status:** Proposed

> **Implementation status (2026-10-09):** built on branch `feat/xlsx-reader`, not yet on
> `main`. The DEFLATE decoder and CRC-32 (`packages/brokers/src/{inflate,crc32}.ts`), the ZIP
> reader (`zip.ts`), the OOXML profile of the XML scanner (`xml.ts`), the number and serial
> readers (`xlsx-values.ts`), the workbook reader (`xlsx.ts`) and the dispatch (`adapter.ts`)
> are in. No XLSX adapter is, so no workbook is recognized yet; the sheet classification of
> decision 6 lands with the first adapter, eToro's, and the web app does not accept `.xlsx`
> until then.

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

An architecture review the same day settled four questions before the workbook reader was
written: what happens to a sheet no adapter knows (decision 6), what a cell is (decision 7),
which time of day a serial gives (decision 9), and which of the things Excel writes the reader
skips rather than refuses (decision 4).

## Decision

1. **Our own ZIP reader and DEFLATE decoder**, no dependency, in `packages/brokers`.
   - `fflate`'s fixed-buffer mode silently drops output past the buffer and decodes on, never
     checks a stored block's NLEN, and its Node build spawns an eval'd worker.
   - The decoder (`inflate.ts`) refuses any stream a conforming encoder would not write: the
     list of rules is in the module. Bytes after the final block are refused, which is
     stricter than Node's zlib.
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
   when they are needed. Before each read, the declared sizes of the parts to read, with
   everything the archive inflated before, must fit `LIMITS.inflatedBytes`. Each part
   inflates to exactly its declared size and CRC-32, never a byte more. The CRC catches a
   decoder or a damaged part, not a file made to deceive: anyone can compute it.
4. **An OOXML profile of the strict XML scanner**, opt-in, so that the plain profile, and
   Interactive Brokers' scan with its element cap, stay as ADR 0012 §1 has them:
   - prefixes are resolved to namespace URIs within `LIMITS.xmlDepth` frames of at most
     `LIMITS.xmlAttributes` declarations each, and elements are matched by URI and local
     name, never by local name alone;
   - declarations are checked as Namespaces in XML 1.0 requires, and an undeclared prefix is
     refused (reason `namespace`);
   - duplicate attributes are checked after resolution;
   - text and attribute values are normalized as a conforming XML processor normalizes them
     (line ends, and white space in a value), so the profile reads what Excel's parser reads;
   - a piece of text holds at most `LIMITS.xlsxCellLength` (32,767, Excel's limit on a cell:
     research 09 §3) characters, counted as code points, and `]]>` in it is refused (reason
     `cdataEnd`); still no DOCTYPE, entity, CDATA or processing instruction; character
     references are allowed and checked, as XML needs `&#13;` to carry a CR;
   - one budget of `LIMITS.xlsxElements` elements for all the parts of a file replaces the
     per-scan element cap, which counts the wrong unit for a sheet.

   The workbook reader then holds the parts to what it reads:
   - inside `sheetData` and `sst`, only the elements decision 7 names; any other, of a foreign
     namespace (`mc:AlternateContent` included) or of SpreadsheetML's own, is refused, and
     text is allowed only in `v`, `t` and `f`;
   - outside them, every element the reader does not read is skipped whole with its text:
     `extLst`, the `definedName` an autofilter leaves, `headerFooter`, a conditional format's
     `formula`, and the like, all of which Excel writes;
   - attributes the reader does not read are ignored, foreign ones included, such as Excel's
     `x14ac:dyDescent` on every row.
5. **The workbook, read through one choke point** (`openWorkbook`):
   - **Package.** `_rels/.rels` names exactly one office document, by the transitional
     relationship type; `[Content_Types].xml` gives every part read its content type, by
     Override or by Default. The workbook part must be SpreadsheetML's
     (`…spreadsheetml.sheet.main+xml`), each sheet `…worksheet+xml` and the shared strings
     `…sharedStrings+xml`.
   - **Parts.** Sheet names and targets come from `workbook.xml` and its relationships,
     matched by relationship Type and resolved as OPC resolves them (relative to the source
     part, dot segments removed, never above the root, compared without regard to case). Two
     sheets pointing at one part are refused, and an External target is never followed.
   - **Parts never inflated.** `docProps`, `customXml`, connections, external links, styles,
     comments, drawings, embeddings, VBA projects.
   - **Rows** are stored sparsely, never allocated from `r`, `dimension`, `spans` or `count`,
     and read once per sheet, when the adapter asks for that sheet. A column past
     `LIMITS.columns`, a row past 1,048,576 (research 09 §3), a cell outside its row, a
     reference out of order or repeated, and an A1 reference of more than 3 letters or 7
     digits, or with a leading zero, are refused. A row or cell without `r` is placed where
     Excel places it: the row after the last, the column after the last. The rows of the
     sheets read count against `LIMITS.recordsPerFile`, and their cells against
     `LIMITS.cellsPerFile`.
   - **Shared strings.** Indices must be canonical and in range, the table within
     `LIMITS.sharedStrings`. A string's text is its runs joined, without phonetic (`rPh`)
     text, within `LIMITS.xlsxCellLength`; its `_xHHHH_` escapes are decoded as ECMA-376's
     `ST_Xstring` defines them, which is what Excel shows, and one naming no character is
     refused. The text the cells make altogether, each shared-string use counted in full, is
     held to `LIMITS.fileBytes` characters, the bound a CSV already has.
   - **What is never read.** Merged cells are never expanded; styles, comments and data
     validation are never read.
   - **Sheets.** Names that are blank, repeat case-insensitively or exceed 31 characters
     (research 09 §3) are refused, and at most `LIMITS.sheetsPerFile` are listed. A name is
     kept exactly as written, trailing spaces included.
   - **Lookups.** Every lookup keyed by file text uses `Map` or `Object.hasOwn`.
6. **Every sheet is known**, as every IBKR section is (ADR 0012 §3).
   - An adapter's `matches` sees only the sheet list (position, name, whether hidden) and the
     date system, so choosing the adapter inflates nothing.
   - Each adapter revision classifies every sheet it knows, by its exact name or an anchored
     pattern (XTB names a sheet `OPEN POSITION 31122025`): read, or skipped whole with a
     reason. A skipped sheet becomes one ignored record carrying that reason.
   - Any other sheet blocks (`unknownSheet`, naming its position), so a sheet a broker adds
     can never drop rows unseen.
   - A hidden sheet an adapter reads blocks (`hiddenSheet`); hidden rows or columns in one
     raise a warning (`hiddenCells`), as the user cannot see what is read.
   - A sheet's rows reach the adapter as `book.rows(position)`, and the adapter receives the
     `Workbook`, never the file's bytes: a test checks that only the workbook module imports
     the ZIP reader and the decoder.
7. **Cells, typed, each with its exact stored text** (kept for the audit):
   - `n` (or no `t`): a number (decision 8); `s`: a shared string; `inlineStr`: an inline
     string, as Apache POI's streaming writer writes every string; `str` without a formula: a
     string; `b`: a boolean, `0` or `1`; `e`: an error, of Excel's closed list;
   - `t="d"` is refused, and so is a cell with a formula (`f`), an empty shared-formula `f`
     included, in a sheet an adapter reads: brokers write no formulas, and a cached value can
     differ from what Excel shows; a cell with metadata (`cm`, `vm`), which can change what
     Excel shows, is refused too;
   - a cell with no value (`v`) is empty, however it is styled;
   - each adapter states, per column, the cell kinds and the conversion it accepts (a
     number cell, or a broker's localized text such as eToro's `1,071.56`), and a cell of
     another kind blocks its row. An error cell blocks where an adapter reads its column.
   - A broker's numeric identifier (a position, order or client ID written as a number) is
     read as an integer of at most 15 digits, or its row blocks: a longer one has lost digits
     in the double, and two positions would share one key.
8. **Numbers: a number cell's exact text, rounded once to 15 significant digits** (research 09
   §1), ties away from zero (`halfUp`, as `Decimal` rounds):
   - a decimal of at most 15 significant digits, stored as a double and written in any
     spelling (shortest, 17-digit or exact), lies within about 2e-16 of it, relative, while
     the nearest 15-digit rounding boundary is at least 5e-16 away: rounding gives the decimal
     back, and also absorbs small arithmetic error (`0.1 + 0.2` written as
     `0.30000000000000004` reads as `0.3`);
   - a writer that emits a decimal's own 16th digit or more loses it, by at most 5e-16
     relative, which ADR 0006's residual rule covers;
   - the text must match an anchored grammar; zero and `-0` read as `0` before digits are
     counted; the decimal exponent, after normalization, lies within ±`LIMITS.xlsxExponent`
     (40), which also excludes subnormals, and the plain decimal that results fits the core's
     `MAX_DECIMAL_LENGTH`; a carry that adds a digit is renormalized; no bound on decimals
     applies (`0.333333333333333` is read as written);
   - it applies to number cells only, never to text cells, serials (decision 9) or
     identifiers (decision 7);
   - this one rounding undoes the binary representation at the reading of the cell, and is
     the exception to ADR 0006 that ADR 0011 left to this decision; ADR 0006 records it.
     Every later step stays exact.
9. **Dates: serials, exactly as stored, in the workbook's own system** (research 09 §2):
   - `date1904` is read from `workbookPr`: `1` or `true` for the 1904 system, `0`, `false` or
     no attribute for the 1900 system; anything else is refused;
   - in the 1900 system, serials below 61 are refused (60 is the 29 February 1900 that never
     was), and in both, serials past 31 December 9999 (2958465 in the 1900 system);
   - the serial's exact text, never rounded to 15 digits, gives the time of day: snapped to
     the nearest millisecond, which removes the binary noise of about a microsecond, then
     truncated to the second, as `fromUtcStamp` reads a broker's text timestamps and as
     brokers' own text exports print them. Truncating never moves an event into the next day,
     or the next tax year;
   - in a column of dates without a time, a serial more than a millisecond off a whole day
     blocks its row;
   - which clock a serial is in is each adapter's statement for its broker (ADR 0011 §7).
     Core has no conversion yet from a local time to an instant across EU summer time, which
     XTB and eToro need: ADR 0011's date policy settles it before either adapter ships.
10. **New limits**, each tested at its value and one past it: `zipEntries` 256,
    `inflatedBytes` 64 MiB, `sheetsPerFile` 32, `cellsPerFile` 2,000,000, `sharedStrings`
    1,000,000, `xlsxCellLength` 32,767, `xlsxElements` 8,000,000 (two elements for each cell
    and each shared string at their limits, with room for rows and runs) and `xlsxExponent`
    40. `LIMITS.cellLength` counts UTF-16 code units in a CSV cell and code points in an XML
    value.
11. **Dispatch.** One routine that requires exactly one matching adapter serves every
    family, in place of the copies `adapter.ts` had. `importFile` hands a ZIP to the XLSX
    family, and the sniff keeps refusing ZIP wherever no workbook can be, as in the command
    line's payers file. The outcomes:
    - a damaged archive or part: `unreadableFile`, with the reason and, where there is one,
      the sheet's position, row and column, never a part name, a sheet name or a value
      (line numbers mean nothing in parts of one line);
    - a ZIP that is no workbook: `fileRefused`, reason `zip`;
    - a macro-enabled (`.xlsm`), binary (`.xlsb`) or Strict Open XML workbook: `fileRefused`
      with a reason of its own (`macroWorkbook`, `binaryWorkbook`, `strictWorkbook`), as is
      any archive carrying a VBA project or a macro sheet;
    - a workbook no adapter recognizes: `unknownFormat`.

    ZIP and XLSX reasons join `UnreadableReason` in core, beside CSV's and XML's. An XLSX
    event's `SourceRef` names its sheet by the adapter's identifier for it (`part`, a closed
    list like IBKR's sections) and its row as Excel numbers it. The web app accepts `.xlsx`
    files once an XLSX adapter ships.
12. **Privacy.** Account IDs go only into `accountScope`. The test suite plants a name in
    every part never read, and in skipped elements of the parts that are read (`x15ac:absPath`,
    which holds a Windows user's path, and banner rows like XTB's): the PII canaries. It
    checks that none reaches a finding or a key.

## Consequences

- **Every broker after Trading 212 and IBKR that exports XLSX reuses this:** eToro first, then
  XTB and Saxo. An adapter sees typed rows by sheet, and states its own sheets (a closed list
  per language and revision), header rows, column kinds and clocks. XTB's header on row 13 is
  the preamble problem ADR 0011 left open: CSV and XLSX share one header finder.
- **Some edits are refused, others cannot be seen.** A formula, a macro or a hidden sheet in a
  file the user saved from Excel is refused, and the message says to export it again,
  unchanged. A value typed over in Excel leaves no trace the reader can find.
- **Before an adapter merges**, the reader is tested on workbooks written by Excel, LibreOffice
  and the writers brokers' backends likely use (Apache POI's streaming writer, the Open XML
  SDK, EPPlus): byte-order marks, data descriptors, inline strings, cells without `r`. Each
  broker's adapter also needs one real, anonymized export.
- **The number rule is an inference from sources,** to be checked against real exports before
  an adapter ships.
- **More code to own:** a ZIP reader and a decoder are new attack surface of our own. In
  exchange there is no dependency and one behavior in both apps, and the differential and
  fault tests keep the surface honest.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0014`
- [ ] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Record the count here, **including zero**.
