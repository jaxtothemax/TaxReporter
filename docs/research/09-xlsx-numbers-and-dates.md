# Numbers and dates in XLSX broker exports

> Researched: 2026-10-09 · Verification: not independently verified
>
> Research for building TaxReporter. It is not tax advice. It settles how a number or a date
> stored in an XLSX cell is read, for the brokers that export only XLSX (eToro, XTB, Saxo:
> [07](07-brokers-eu-and-others.md)). The rule it leads to is ADR 0014 §7–8.

## 1. A number in a cell is a binary double

**Excel keeps 15 significant digits** [H]. Microsoft's *Worksheet and workbook
specifications and limits* lists, under calculation specifications, "Number precision:
15 digits". Microsoft's KB 78113, *Floating-point arithmetic may give inaccurate results in
Excel*, attributes the limit to IEEE 754 double precision, which other spreadsheets share.

**The cell's text is a decimal spelling of that double.** In SpreadsheetML (ECMA-376,
ISO/IEC 29500-1), a numeric cell's `<v>` holds the number as text. Writers emit the double's
shortest round-trip spelling, up to 17 significant digits. So a value that was 0.3 can arrive
as `0.30000000000000004` (0.1 + 0.2 computed in binary), and 2.631579 as
`2.6315789999999998`.

**Any decimal of up to 15 significant digits survives a trip through a double** [H]. ISO C
(C11, committee draft N1570, §5.2.4.2.2) defines `DBL_DIG` as the number of decimal digits q
"such that any floating-point number with q decimal digits can be rounded into a
floating-point number with p radix b digits and back again without change to the q decimal
digits". For IEEE 754 binary64 (p = 53, b = 2) that is floor(52 · log10 2) = 15.

**The rule that follows (inference).** Read the cell's text exactly, then round it, half up,
to 15 significant digits.

- If the producing program held a decimal of up to 15 significant digits, as everything Excel
  stores is, this gives that decimal back exactly. The double nearest to it is the one
  stored, and its spelling lies within half a unit of the 17th digit, so rounding at the 15th
  cannot cross a boundary.
- A value with more significant digits than that never existed as a decimal in the
  spreadsheet: no rule could recover it.
- Rounding happens once, here, at the reading of the cell: it undoes the binary
  representation, so it is no intermediate rounding of the kind ADR 0006 rules out. Every
  later step stays exact.

**The text is checked before it is used.** An anchored grammar: optional minus, digits,
optional fraction, optional exponent. The exponent is bounded before anything is expanded
(a cell may not write `1e999999999`). The cell's display format (style) is never read: the
stored value is the value.

## 2. A date in a cell is a serial number

**Two date systems** [H]. Microsoft's *[MS-XLS]: Date1904* record defines them:

- the 1900 system: "The first date of the 1900 date system is 00:00:00 on January 1, 1900,
  specified by a serial value of 1";
- the 1904 system: "The first date of the 1904 date system is 00:00:00 on January 1, 1904,
  specified by a serial value of 0".

In SpreadsheetML the choice is the `date1904` attribute of `workbookPr` in `workbook.xml`
(ISO/IEC 29500-1:2008 §18.2.28); absent, it is false, the 1900 system. The same serial is a
date 1,462 days apart in the two systems, so the attribute must be read, never assumed.

**The 1900 system counts a day that never was** [H]. SpreadsheetML on the 1900 base treats
1900 as a leap year, for compatibility with Lotus 1-2-3, so serial 60 is 29 February 1900.
Microsoft's troubleshooting article *Excel incorrectly assumes that the year 1900 is a leap
year* traces it to Lotus 1-2-3 and says only 1900 is affected. Serials 1–59 therefore count
from 31 December 1899, and serials from 61 count from 30 December 1899.

**The rule that follows (inference).**

- A serial below 61 in the 1900 system is refused: serial 60 is no day, and anything earlier
  predates every broker export by a century.
- From 61 on, the date is 30 December 1899 plus the serial's whole days. In the 1904 system it
  is 1 January 1904 plus the whole days.
- The fraction is the time of day: the fraction times 86,400 seconds, rounded half up to the
  nearest second, in exact decimal arithmetic.
- Known answers, from the definitions above:
  - serial 45953 in the 1900 system is 23 October 2025;
  - 45657.99998842592 is 31 December 2024, 23:59:59;
  - serial 44491 is 22 October 2021 in the 1900 system and 23 October 2025 in the 1904 system.
- Which clock a serial is in (the exchange's, the broker's, UTC) is no property of the file:
  each adapter states it for its broker, as ADR 0011 §7 requires.

## 3. What Excel holds a workbook to

**A cell holds at most 32,767 characters; a worksheet, 1,048,576 rows by 16,384 columns** [H].
Microsoft's *Worksheet and workbook specifications and limits*, the page §1 cites, lists
"Total number of characters that a cell can contain: 32,767 characters" and "Total number of
rows and columns on a worksheet: 1,048,576 rows by 16,384 columns". Column 16,384 is `XFD`,
three letters; row 1,048,576 has seven digits.

**A sheet's name has at most 31 characters** [H]. Microsoft's *Rename a worksheet* says that
worksheet names cannot "Be blank", "Contain more than 31 characters", "Contain any of the
following characters: / \ ? * : [ ]", or begin or end with an apostrophe.

**The rule that follows (inference).** A workbook Excel wrote stays within these bounds, and so
does a program that writes workbooks for Excel to open. The reader therefore refuses anything
past them rather than read it:

- a piece of text longer than 32,767 characters (`LIMITS.xlsxCellLength`);
- a cell reference past `XFD1048576`;
- a sheet name that is blank or longer than 31 characters.

## Sources

- Microsoft, *Worksheet and workbook specifications and limits* (Excel for Microsoft 365, 2024,
  2021, 2019, 2016): https://support.microsoft.com/office/1672b34d-7043-467e-8e27-269d656771c3
- Microsoft, KB 78113, *Floating-point arithmetic may give inaccurate results in Excel*:
  https://support.microsoft.com/kb/78113
- Microsoft, *[MS-XLS]: Date1904*:
  https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/4a5e900a-0eb0-4355-8fc1-81aab8f46e8b
- Microsoft, *Excel incorrectly assumes that the year 1900 is a leap year*:
  https://learn.microsoft.com/office/troubleshoot/excel/wrongly-assumes-1900-is-leap-year
- Microsoft, *Rename a worksheet*:
  https://support.microsoft.com/office/rename-a-worksheet-3f1f7148-ee83-404d-8ef0-9ff99fbad1f9
- ECMA-376 / ISO/IEC 29500-1, Office Open XML, Part 1 (SpreadsheetML; `workbookPr`
  §18.2.28 in the 2008 edition). Clause numbers vary by edition: check the edition cited.
- ISO/IEC 9899:2011 (C11), §5.2.4.2.2, `DBL_DIG`; committee draft N1570, p. 28:
  https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf

## Confidence

- Every statement marked [H] is quoted or paraphrased from the primary source listed. Clause
  numbers in ISO/IEC 29500-1 differ between editions; the text cited is the 2008 edition's.
- The rules are inferences from those facts, made here, and are what ADR 0014 adopts.
  They are to be checked against real eToro and XTB exports before either adapter ships.
