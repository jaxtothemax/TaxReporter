# Trade Republic fixtures

A synthetic transaction export, of the one revision known (April 2026), with
the 23 columns and quoting `docs/research/07-brokers-eu-and-others.md` §4.2
gives. No row comes from a real account: transaction IDs are placeholders,
amounts are made up, and the only securities are a world equity fund and
Apple, bought and sold at invented prices.

| File                       | Revision                      | Header source                         |
| -------------------------- | ----------------------------- | ------------------------------------- |
| `tr-transactions-2026.csv` | April 2026 transaction export | The research's header, quoted exactly |

What it shows: savings-plan purchases of a fund, a purchase and a sale of a
share, a sale at 22:40 UTC that falls on the next day in Ljubljana, a
deposit, a card payment and interest.

The research rates the format at medium confidence, from parser fixtures. It
has to be checked against a real, anonymized export before the adapter
ships: add one beside this file when it is available, and keep both passing.
A real export with a dividend would also settle what its columns hold on a
dividend row, which the adapter refuses until then.
