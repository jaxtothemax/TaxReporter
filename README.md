# TaxReporter

**Turn your foreign broker's export into XML you can import into FURS eDavki — on your own
computer, with every amount converted at the Banka Slovenije rate.**

If you are a Slovenian tax resident with a foreign broker (Trading 212, Interactive
Brokers, eToro, Revolut, …), nobody reports your trades or dividends to FURS for you. You
must file **Doh-KDVP** (gains from selling stocks and ETFs) and **Doh-Div** (dividends)
yourself, by the end of February, converting every purchase, sale and dividend to euros at
the Banka Slovenije rate for its own day. TaxReporter does that conversion and the paperwork
from the files your broker already gives you.

> **Status: pre-alpha.** Nothing is usable yet. The first milestone (v0.1) targets
> Doh-KDVP and Doh-Div for **Trading 212**, **Interactive Brokers** and **Trade Republic**, for tax year 2026
> (returns due by the end of February 2027). See the [roadmap](website/src/content/docs/roadmap.md).

## What it will do

- **Read the exports you already have.** Starting with the Trading 212 CSV, the IBKR Flex
  Query XML and the Trade Republic transaction export, then eToro, XTB, DEGIRO, Revolut and
  others. Parsing is deterministic;
  no AI guesses at your numbers.
- **Use the rate the law names.** Every amount is converted at the Banka Slovenije reference
  rate valid on the transaction date (ZDoh-2 Art. 16, 98 and 99). TaxReporter shows the rate
  and list date behind each converted amount.
- **Apply FIFO per security across all your brokers**, as FURS requires, instead of per
  file.
- **Write eDavki-ready XML.** It is validated against the official FURS schemas before you
  download it, so the import does not fail on a technicality.
- **Offer an optional AI second opinion.** With your own API key, a language model can review
  a redacted summary and point out anything that looks odd. It never changes a figure, and
  it is off unless you turn it on.

## Your data stays with you

TaxReporter runs entirely in your browser (or as a command-line tool on your machine). There
is no server, no account and no tracking. Your broker statements are never uploaded
anywhere. The only data the app downloads is the public exchange-rate table published by this
project. The optional AI check sends a redacted summary, and only after you have seen it and
confirmed. The architecture decision is in [ADR 0002](docs/adr/0002-local-first-processing-on-the-users-device.md).

## Not tax advice

TaxReporter prepares a return **for you to review and submit**. It is not affiliated with
FURS, and it is not a substitute for a tax adviser. You are responsible for what you file.
If something looks wrong, check it against the
FURS instructions (for example the [Doh-KDVP instructions](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf))
or ask an adviser, and please open an issue.

## For contributors

TaxReporter is a TypeScript monorepo (Node 24, pnpm). See [ADR 0003](docs/adr/0003-typescript-monorepo-with-pnpm-workspaces.md).

```bash
make setup     # install dependencies and git hooks
make doctor    # check your toolchain
make test      # run every package's tests
```

- **Start here:** [CONTRIBUTING.md](CONTRIBUTING.md). Adding a broker adapter is the most
  valuable contribution, and it does not require knowing tax law.
- **Background research** on the FURS schemas, Slovenian tax rules, Banka Slovenije rates,
  broker export formats and prior art is in [docs/research/](docs/research/).
- **Architecture decisions** are in [docs/adr/](docs/adr/).
- **Security issues:** report privately, see [SECURITY.md](SECURITY.md).

The development process (review gates, changelog fragments, release flow) comes from the
[Blueprint](https://gitlab.com/macrodream/blueprint) delivery harness, adapted to GitHub. See
`CLAUDE.md` for how it is used here.

## Credits

- Exchange rates: **Banka Slovenije** (www.bsi.si), *Dnevna tečajnica – referenčni tečaji
  ECB* and *Mesečna tečajnica*, CC BY 4.0. Values are reused unchanged.
- Form schemas: **FURS** eDavki (edavki.durs.si).
- Prior art that showed the way, especially [ib-edavki](https://github.com/ib-edavki/ib-edavki).

## License

[GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified version
as a service for others, you must publish your changes.
