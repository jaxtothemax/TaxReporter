# Trading 212 fixtures

Synthetic exports, one per header revision of
`docs/research/06-brokers-ibkr-t212-revolut.md` §4.4. Together they form one
account's history from 2022 to 2026. No row comes from a real account: IDs
are placeholders, amounts are made up (cash totals are kept roughly
consistent), and Acme Corp (`US00000ACME1`) does not exist.

| File                      | Revision                                                         | Header source                                             |
| ------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `t212-invest-v1-2022.csv` | V1: currency in the header (`Total (EUR)`), `Notes,ID` last      | Reconstructed from the research description; illustrative |
| `t212-invest-v2-2024.csv` | V2: `Currency (Total)` columns, `Notes,ID` after the tax columns | Reconstructed from the research description; illustrative |
| `t212-invest-v3-2025.csv` | V3: `Notes,ID` after `Name`, conversion and merchant columns     | The real January 2026 header quoted in cgt-calc #709      |
| `t212-invest-v4-2026.csv` | V4: `Time (UTC)`                                                 | The research's synthetic 2026 fixture, extended           |

The research warns that every fixture has to be checked against a real,
anonymized export of the revision it claims to be before the parser ships.
That check is still to do: add an anonymized real export next to each file
when one is available, and keep both passing.
