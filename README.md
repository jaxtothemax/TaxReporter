# TaxReporter

**Turn your foreign broker's exports into XML you can import into FURS eDavki — on your own
computer, with every amount converted at the Banka Slovenije rate.**

If you are a Slovenian tax resident and invest through a foreign broker (Trading 212,
Interactive Brokers, Trade Republic, eToro, …), nobody reports your trades or dividends to
FURS for you. You file **Doh-KDVP** (gains from selling shares and ETFs) and **Doh-Div**
(dividends) yourself, by the end of February, with every purchase, sale and dividend converted
to euros at the Banka Slovenije rate for its own day. TaxReporter does that work from the files
your broker already gives you, on your own device, and shows you where every number came from.

> **Status: pre-alpha, no release yet.** Version 0.1 is being built for tax year 2026 (returns
> due by 1 March 2027), for Trading 212, Interactive Brokers and Trade Republic. The source can
> already read these brokers' exports and write both returns: see [Try it](#try-it). Treat what
> it writes as a draft to check, never as a finished return.

> [!IMPORTANT]
> **Check every figure before you file.** TaxReporter can be wrong. The return you file is your
> responsibility, not that of the people who make TaxReporter. Read
> [Check every figure yourself](#check-every-figure-yourself) before you rely on it.

## Who it's for

- **Savers with a savings plan.** A monthly ETF purchase on Trading 212 or Trade Republic means
  dozens or hundreds of small purchases, each converted at its own day's rate and matched when
  you sell. TaxReporter does that from the export, and says in plain words, in Slovenian or
  English, when something needs your attention.
- **Active investors with more than one broker.** Sales are matched first in, first out per
  security across every broker and account you add, the way the law requires, not per file.
  Trades in dollars, pounds or francs, stock splits and dividends with foreign tax withheld are
  handled. Anything TaxReporter does not understand, such as a spin-off, is refused with an
  explanation instead of guessed.
- **Accountants preparing returns for clients.** The command-line tool writes the same XML for
  the same files every time, one client at a time, and client data never leaves the office
  computer.
- **Developers.** Adding a broker is a contained piece of work with a small interface and test
  fixtures to copy. See [Get involved](#get-involved).

Not covered yet: shares from an employer's plan (RSUs, ESPP), interest (Doh-Obr) and
derivatives such as options and CFDs (D-IFI). They are on the
[roadmap](website/src/content/docs/roadmap.md).

## How it works

```text
broker exports ─► read ─► one ledger ─► Banka Slovenije rates ─► FIFO ─► Doh-KDVP / Doh-Div XML ─► you check ─► eDavki
```

1. **You export your whole history** from each broker, from the day you opened the account.
   Sales are matched against your earliest purchases, so a missing year changes the result.
2. **Each file is read on your device.** TaxReporter recognizes a file by its content, never by
   its name. Every row becomes an event in one ledger, an ignored row with its reason (a
   deposit, for example), or a finding that stops the return until you resolve it. No row is
   dropped silently, and nothing is guessed.
3. **Every amount is converted at the Banka Slovenije rate** valid on its day: the trade date for
   a purchase or sale (never the settlement date), the payment date for a dividend. A weekend or
   holiday uses the last list published before it, and a currency missing from the daily list
   uses the monthly one. The broker's own exchange rate is never used. Banka Slovenije's lists
   since 2007 come with the app, so converting needs no other server, and every converted
   amount keeps its rate, the list's date and its source. The lists included today run to
   7 October 2026; a later date stops with a finding until they are refreshed
   ([#21](https://github.com/jaxtothemax/TaxReporter/issues/21)).
4. **Sales are matched first in, first out (FIFO)** per security, by ISIN, across all your
   brokers and accounts. How long each purchase was held sets the rate on its part of the
   gain: 25%, falling to 20% after five years, 15% after ten and none after fifteen. The part of
   a loss that you bought back within 30 days before or after the sale does not count.
5. **Doh-KDVP and Doh-Div are written as eDavki XML** in the structure of FURS's published
   schemas, which the project's tests check every kind of return against. Before a file is
   written, it is checked against the rules the schemas leave out. Foreign tax withheld stays
   with its dividend. Brokers do not export a dividend payer's address, which Doh-Div needs, so
   you add it once per security. A return is withheld, with the reason, while any finding blocks
   it.
6. **You check it, then import it into eDavki yourself.** TaxReporter shows an estimate of the
   tax and the source of every figure. It never files anything.

## What it reads today

From source, before the first release:

| Broker              | Export                                                                                                                 | Read                                                    | Refused, among others                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Trading 212         | History export, CSV (four header revisions)                                                                 | Purchases, sales, dividends with the tax withheld, splits | Payments in lieu of dividends, tax-exempt and bonus dividends, spin-offs, transfers, stock distributions                                          |
| Interactive Brokers | Activity Flex Query, XML ([how to set it up](website/src/content/docs/guides/run-from-source.md#setting-up-the-ibkr-flex-query)) | Trades, dividends with the tax withheld, splits that keep the ISIN | Payments in lieu of dividends, other corporate actions, cancellations and corrections, short sales, option exercises                             |
| Trade Republic      | Transaction export, CSV (offered since April 2026)                                                                     | Purchases, sales, savings plans                         | Dividends, until a real export confirms their columns ([#12](https://github.com/jaxtothemax/TaxReporter/issues/12)); trades with a foreign-currency leg; free shares; corporate actions and deliveries; bonds and crypto |

The project's tests use synthetic exports written to each format's published description;
each reader still has to pass a real, anonymized export before v0.1 ships. Both the browser app
and the command-line tool write the same XML for the same files. Next, in
order of how many Slovenian investors use them: eToro, XTB, DEGIRO, Revolut, Lightyear, Saxo and
Robinhood. The spreadsheet (XLSX) reader that eToro, XTB and Saxo need is built; their adapters
wait on real, anonymized exports.

## Check every figure yourself

TaxReporter prepares a **draft** for you to review. The return you submit in eDavki is yours: you
sign it, and you are responsible for what it says.

- **It can be wrong.** It is pre-release software. Brokers change their exports without notice,
  an export can itself be incomplete or wrong, and tax law has cases TaxReporter does not know.
- **Check before you import.** Compare the totals with your broker's own annual statement, check
  each sale's dates, quantity and values, look up a few rates on [bsi.si](https://www.bsi.si),
  and read every finding. The tax TaxReporter shows is an estimate; eDavki computes the real
  amount.
- **It is not tax advice**, and it is not affiliated with FURS, Banka Slovenije or any broker.
  When you are unsure, ask a tax adviser or FURS.
- **Nobody behind it accepts liability.** TaxReporter is free software, provided "as is",
  without any warranty. As far as the law allows, its authors and contributors are not
  responsible for errors in a return prepared with it, or for any tax, interest or penalty that
  follows. See sections 15 and 16 of the [license](LICENSE).

If a number looks wrong, please [open an issue](https://github.com/jaxtothemax/TaxReporter/issues)
and describe it, without attaching your files.

## Your data stays on your device

TaxReporter runs in your browser or as a command-line tool on your computer. There is no server,
no account and no tracking, and your broker files are never uploaded. In the browser, files are
read in a background worker whose network access is removed before it reads anything, under a
strict Content Security Policy, and closing the tab forgets them. A browser test that proves no
request leaves during an import is still to come ([#2](https://github.com/jaxtothemax/TaxReporter/issues/2)). See [ADR 0002](docs/adr/0002-local-first-processing-on-the-users-device.md)
and [Privacy and security](website/src/content/docs/guides/privacy-and-security.md).

An optional AI "second opinion" is planned: it will run only with your own API key, after you
have seen exactly what it sends, and it will never change a figure.

## Try it

There is no release to install yet. To run it from source you need Node.js 24 and pnpm 10:

```bash
git clone https://github.com/jaxtothemax/TaxReporter.git
cd TaxReporter
pnpm install --frozen-lockfile
pnpm run build
pnpm --dir apps/web build && pnpm --dir apps/web preview   # the browser app, at http://localhost:4173
```

[Run it from source](website/src/content/docs/guides/run-from-source.md) covers the command-line
tool, setting up the IBKR Flex Query, and the payer file Doh-Div needs. The full documentation is
at [jaxtothemax.github.io/TaxReporter](https://jaxtothemax.github.io/TaxReporter/).

## Get involved

TaxReporter is built in the open, and you do not need to be a tax expert to help. Each broker it
reads saves its users from converting hundreds of rows by hand or uploading their statements to
a paid service.

- **Try it on your own exports and tell us what breaks.** Open an issue that names the broker,
  the export and what went wrong. Paste only the header row, with every number, ID and name
  replaced by made-up values. Never attach the real file: issues are public.
- **Help confirm a broker's format.** An adapter ships only once a real export has been checked
  against it. The issues for eToro ([#8](https://github.com/jaxtothemax/TaxReporter/issues/8))
  and Trade Republic ([#12](https://github.com/jaxtothemax/TaxReporter/issues/12)) list what we
  need to know, and you can answer most of it from your own file without sharing it.
- **Add a broker.** An adapter turns one export into ledger events; exchange rates, FIFO and the
  XML are shared, so it never touches them.
  [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-broker-adapter) lists what a new adapter needs, and
  the Trading 212, IBKR and Trade Republic adapters are worked examples.
- **Check the tax rules.** Every rule cites its primary source (the law, FURS instructions and
  schemas, Banka Slovenije) in [docs/research/](docs/research/). If you know Slovenian tax law,
  reviewing those notes and their open questions is one of the most useful things you can do.
- **Improve the docs**, including the planned Slovenian translation of the documentation site.

The [open issues](https://github.com/jaxtothemax/TaxReporter/issues) show what is planned and
what is in progress. Security issues are reported privately: see [SECURITY.md](SECURITY.md).

### For developers

A TypeScript monorepo on Node 24 with pnpm workspaces
([ADR 0003](docs/adr/0003-typescript-monorepo-with-pnpm-workspaces.md)):

| Path                   | What it holds                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `packages/core`        | The ledger, exact decimal arithmetic, FIFO, the 30-day rule, the tax estimate, findings |
| `packages/fx`          | Banka Slovenije's rate lists, and choosing the rate for a date                         |
| `packages/furs`        | Doh-KDVP and Doh-Div XML, with the vendored FURS schemas                               |
| `packages/brokers`     | The import contract, the broker adapters, and strict CSV, XML, ZIP and XLSX readers    |
| `packages/pipeline`    | One path from files to returns, shared by both apps                                    |
| `apps/cli`, `apps/web` | The command-line tool and the browser app                                              |
| `website/`             | The documentation site                                                                 |
| `docs/`                | Research with its sources, architecture decisions (ADRs) and specs                     |

```bash
make setup     # install dependencies and git hooks
make doctor    # check your toolchain
make test      # run every package's tests
```

The development process (review gates, changelog fragments, release flow) comes from the
[Blueprint](https://gitlab.com/macrodream/blueprint) delivery harness, adapted to GitHub;
`CLAUDE.md` describes how it is used here.

## Credits

- Exchange rates: **Banka Slovenije** (www.bsi.si), _Dnevna tečajnica – referenčni tečaji ECB_
  and _Mesečna tečajnica_, CC BY 4.0. Values are reused unchanged.
- Form schemas: **FURS** eDavki (edavki.durs.si).
- Prior art that showed the way, especially [ib-edavki](https://github.com/ib-edavki/ib-edavki).

## License

[GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified version as a
service for others, you must publish your changes.
