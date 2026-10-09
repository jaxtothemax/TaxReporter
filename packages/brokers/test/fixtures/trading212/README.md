# Trading 212 fixtures

Synthetic exports: one per header revision of
`docs/research/06-brokers-ibkr-t212-revolut.md` §4.4, which together form one
account's history from 2022 to 2026, and a second V4 file for another
account. No row comes from a real account: IDs are placeholders, amounts are
made up (cash totals are kept roughly consistent), and Acme Corp
(`US00000ACME1`) does not exist.

| File                               | Revision                                                         | Header source                                             |
| ---------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `t212-invest-v1-2022.csv`          | V1: currency in the header (`Total (EUR)`), `Notes,ID` last      | Reconstructed from the research description; illustrative |
| `t212-invest-v2-2024.csv`          | V2: `Currency (Total)` columns, `Notes,ID` after the tax columns | Reconstructed from the research description; illustrative |
| `t212-invest-v3-2025.csv`          | V3: `Notes,ID` after `Name`, conversion and merchant columns     | The real January 2026 header quoted in cgt-calc #709      |
| `t212-invest-v4-2026.csv`          | V4: `Time (UTC)`                                                 | The research's synthetic 2026 fixture, extended           |
| `t212-invest-v4-2026-takeover.csv` | V4 without `Notes`, as an export with no notes writes it         | A real export's header (October 2026); rows made up       |

`t212-invest-v4-2026-takeover.csv` holds made-up rows of the kinds a real
2025 export had and the other files lack (research 06 §4.2, §4.3): a
takeover paid in shares, priced `0E-10`, a distribution of rights, and
dividends priced to 6 decimals. Orbit Corp (`US00000ORBT1`), Nova Holdings
(`US00000NOVA8`) and Vega Rights (`US00000VEGA3`) do not exist either.

The research warns that every fixture has to be checked against a real,
anonymized export of the revision it claims to be before the parser ships.
V4's header has been: a real export had the same columns in the same order,
less the ones it had no use for, such as `Notes` when no row has a note. The
other revisions are still to check: add an anonymized real export next to
each file when one is available, and keep both passing.
