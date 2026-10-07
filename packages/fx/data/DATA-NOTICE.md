# Exchange-rate data notice

The files in this directory are **not covered by the project's AGPL license.**

- `bsi-daily.csv`: the daily exchange-rate list of Banka Slovenije ("Dnevna tečajnica,
  referenčni tečaji ECB"), from `https://www.bsi.si/_data/tecajnice/dtecbs-l.xml`.
- `bsi-monthly.csv`: Banka Slovenije's monthly list of other currencies, from
  `https://www.bsi.si/_data/tecajnice/EksotTecBS-l.xml`.
- `snapshot.json`: when each file was retrieved, its `Last-Modified` and SHA-256.

**Source: Banka Slovenije (ECB reference rates).** The data is redistributed under Banka
Slovenije's terms of use, which allow storing, reproducing and distributing it provided the
source is clearly stated and the data is left unchanged (see
`docs/research/03-bsi-exchange-rates.md` §12), and is listed as CC BY 4.0 on the Slovenian
open-data portal (OPSI).

**What was changed:** the format only. Each list's rates were copied from BSI's XML into one
CSV row, column per currency, with every value exactly as BSI wrote it (trailing zeros kept).
The ten monthly lists that BSI split into two elements in 2008–2009 are merged into one row.
No value was added, removed, corrected or recomputed; known differences from the ECB's own
values are reported by the app at lookup time, not edited here.

The data is free on bsi.si; Banka Slovenije disclaims its accuracy. Rebuild with
`packages/fx/scripts/build-snapshot.mjs`.
