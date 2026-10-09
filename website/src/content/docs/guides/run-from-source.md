---
title: Run it from source
description:
  Try TaxReporter before its first release, on your own computer, from the command line or
  in your browser.
---

There is no release yet: the first version, v0.1, is underway (see the
[roadmap](/roadmap/)). Its source can already read your exports and write the returns, so you
can try it on your own computer. Treat what it writes as a draft to check, not a return to
file.

## What it reads today

- **Trading 212:** the CSV export of your account history.
- **Interactive Brokers (IBKR):** an Activity Flex Query in XML (see below for its sections).
- **Trade Republic:** the transaction export (CSV), with all transactions. Its dividends are
  not read yet: a file with one stops both returns and says why.

Export your **whole history**, from the day you opened the account: each sale is matched
against your earliest purchases of the same security first.

### Setting up the IBKR Flex Query

In the Client Portal, open **Performance & Reports → Flex Queries** and add an **Activity Flex
Query**, delivered as **XML**, with these sections:

| Section                          | What to tick                                                   |
| -------------------------------- | -------------------------------------------------------------- |
| Account Information              | Account ID and IB Entity                                       |
| Trades                           | Executions, all fields (not Orders or Symbol Summary)          |
| Corporate Actions                | All fields                                                     |
| Cash Transactions                | Dividends, Payment in Lieu of Dividends, Withholding Tax       |
| Financial Instrument Information | All fields                                                     |
| Transfers                        | All fields                                                     |

Keep the general settings at their defaults (date `yyyyMMdd`). Select every account, closed
and migrated ones included, and run the query once per calendar year since you opened the
account: IBKR returns at most 365 days at a time.

## What you need

- [Node.js](https://nodejs.org/) 24 or newer.
- [pnpm](https://pnpm.io/) 10: run `corepack enable` once, and Node provides it.
- [Git](https://git-scm.com/), to fetch the source.

```bash
git clone https://github.com/jaxtothemax/broker-to-edavki.git
cd broker-to-edavki
pnpm install --frozen-lockfile
pnpm run build
```

## In your browser

```bash
pnpm --dir apps/web build
pnpm --dir apps/web preview
```

Open the address it prints (usually `http://localhost:4173`). The build carries the app's
security policy, under which the files you add are read in a background worker whose network
and storage functions are removed and which may load only the app's own files. Nothing is uploaded, and closing the tab forgets them.

`pnpm --dir apps/web dev` runs the same app for development, without that policy.

## On the command line

```bash
node apps/cli/dist/bin.js my-exports/*.csv my-exports/*.xml \
  --year 2026 --tax-number 12345678 --out returns/ --payers payers.json
```

It prints what it read, the estimated tax and every finding, and writes `Doh_KDVP_2026.xml` and
`Doh_Div_2026.xml` into `returns/` when nothing blocks them; a return with nothing on it is not
written. The exit code is 0 when nothing blocks, 1 when something does, and 2 for a mistake in
the command. Add `--json` for a report other tools can read.

Brokers do not export a dividend payer's address, which Doh-Div needs, so give it in a small
JSON file, one entry per security (by ISIN):

```json
{
  "US1912161007": {
    "name": "The Coca-Cola Company",
    "address": "One Coca-Cola Plaza, Atlanta, GA 30313, United States",
    "country": "US"
  }
}
```

A Slovenian payer also takes `"taxNumber"`, and a foreign one may take its
`"identificationNumber"`.

## Before you import anything

Compare every figure with your broker's own statements, and read every finding. TaxReporter
prepares a return for you to check; it does not file it, and it is not tax advice. If a number
looks wrong, please [open an issue](https://github.com/jaxtothemax/broker-to-edavki/issues), without
attaching your files.
