# Interactive Brokers fixtures

Synthetic Activity Flex Query statements, written to the structure and
attribute names of research 06 §3 (`docs/research/06-brokers-ibkr-t212-revolut.md`).
Every account number, transaction ID, action ID and amount is made up; no
real export was used. Replace or extend them with anonymized real exports
(account IDs, transaction IDs and descriptions scrubbed) when users provide
them, and keep these passing.

- `flex-activity-2025-2026.xml`: a client migrated from IB Central Europe
  (U16000001, 2025) to IB Ireland (U16000002, 2026) in one file. It holds
  executions, an order-level and a closed-lot row, an option trade, an FX
  conversion, a 2-for-1 split, dividends with their US tax, a reversed and
  re-booked dividend told apart by action IDs, interest, a deposit, a
  withdrawal, a transfer between the two accounts, and a summary section.
