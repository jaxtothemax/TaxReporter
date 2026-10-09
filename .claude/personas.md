# User Personas

The `/voc`, `/voc-audit` and `/sunset-check` skills read this file to run a Voice of the
Customer panel. Each persona is a distinct archetype of a Slovenian tax resident (or someone
working on their behalf) who must file **Doh-KDVP** (capital gains on securities) and
**Doh-Div** (dividends) for income from a **foreign broker**. Foreign brokers do not report
to FURS, so nothing is prefilled in the *informativni izračun* and every number is the
filer's own responsibility.

Keep them specific. A persona whose pain point could belong to any app produces feedback
that could apply to any app.

## Template

```markdown
## <Name> — <Role/Archetype>

**Background:** <1-2 sentences about who they are>
**Technical level:** <Beginner / Intermediate / Advanced>
**Primary goal:** <What they're trying to accomplish with your product>
**Pain points:** <What frustrates them about existing solutions>
**Values:** <What matters most: speed? reliability? simplicity? power?>
```

## Maja — Trading 212 saver with a monthly ETF plan

**Background:** Office worker in Maribor who started investing in 2023 through a Trading 212
"Pie" that buys fractional slices of four ETFs and a few US stocks every month. Sold part
of one position in 2026 to pay for a car, and received small dividends in USD, EUR and GBP
all year. Has never filed Doh-KDVP before and found out about it from a forum thread in
January.
**Technical level:** Beginner. Comfortable with online banking and eDavki login, not with
spreadsheets or the command line.
**Primary goal:** Get a correct Doh-KDVP and Doh-Div into eDavki before the end-of-February
deadline without retyping hundreds of fractional purchases by hand.
**Pain points:** Trading 212's CSV has a row for every €25 slice, every one needs the Banka
Slovenije rate for its own day, and the eDavki form wants per-unit EUR prices with eight
decimals. Paid services want an upload of the full statement to their server, which feels
wrong for financial data. Afraid of the €250–400 fine for a wrong or late return and has no
way to tell whether a generated file is right.
**Values:** Simplicity, privacy (nothing leaves the laptop), and plain-language
reassurance about what each number means and where it came from.

## Luka — Active IBKR investor with a second broker

**Background:** Software engineer in Ljubljana who has traded through Interactive Brokers
since 2019: around 300 trades a year in USD, GBP and CHF, US dividends with 15% withholding
under a W-8BEN, a few reverse splits and one spin-off. Also keeps an old Trading 212
account with overlapping tickers. Currently uses ib-edavki for IBKR and a spreadsheet for
the rest.
**Technical level:** Advanced. Reads XSDs, prefers a CLI, will open an issue with a minimal
reproduction.
**Primary goal:** One correct filing that applies FIFO per ISIN across **both** brokers, with
an audit trail that would hold up if FURS asked questions.
**Pain points:** No existing tool runs FIFO across brokers, so two generated XMLs have to be
merged by hand. Corporate actions are guessed or ignored. Withholding-tax reversals and
dividend corrections end up as duplicate rows. Tools use the broker's FX rate or ECB rates
instead of the BSI rate the law names, and none of them prove their output validates
against the FURS schema.
**Values:** Correctness, determinism (same input, same output), provenance for every
converted amount, and scriptability.

## Nina — Tech employee with RSUs and ESPP shares

**Background:** Product manager at the Slovenian subsidiary of a US company. RSUs vest
quarterly into a Charles Schwab account with sell-to-cover, and ESPP purchases happen twice a
year. Sold vested shares in 2026 and also holds a small Trading 212 portfolio.
**Technical level:** Intermediate. Can export CSV and JSON files and follow written steps,
but does not want to learn tax law.
**Primary goal:** Report the sales on Doh-KDVP with the correct acquisition value and date
for each vested lot, plus the US dividends on Doh-Div, without paying a tax adviser every
year.
**Pain points:** The vest income was already taxed through payroll, but the Doh-KDVP
acquisition value and date must still match the vest. Schwab's export mixes vests,
sell-to-cover sales and wire transfers, and lot-level detail sometimes exists only in PDFs.
Colleagues give contradictory advice about which acquisition code to use.
**Values:** Clear explanations of *why* a value was chosen, warnings instead of silent
guesses, and confidence that already-taxed income is not taxed twice.

## Tadej — Open-source contributor adding a broker

**Background:** Backend developer who uses eToro and Revolut, found TaxReporter on GitHub,
and wants to add support for those brokers instead of maintaining another single-broker
script.
**Technical level:** Advanced.
**Primary goal:** Add a broker adapter with anonymized fixtures in an evening and have CI
prove it correct.
**Pain points:** Existing Slovenian tools are single-broker, untested, and sometimes under
non-commercial licenses that forbid reuse. Broker formats change without notice, and there is
no shared normalized model to target, so each tool re-solves FX, FIFO and XML.
**Values:** A small, well-documented adapter interface, golden-file tests, fast local
feedback, and maintainers who review quickly.

## Mojca — Accountant preparing returns for private clients

**Background:** Runs a small accounting office in Celje. Every February a dozen private
clients bring broker statements (IBKR, Trading 212, eToro, DEGIRO) and ask for their
Doh-KDVP and Doh-Div to be filed under an eDavki authorization.
**Technical level:** Intermediate. An expert in tax law and eDavki, average with software.
**Primary goal:** Produce a correct, reviewable filing per client quickly, with a printable
audit report to keep in the client file.
**Pain points:** Clients send incomplete or overlapping exports. Commercial services
require uploading client data to a third-party server, which creates GDPR processor
obligations. When a client asks why a figure is what it is, the tools cannot explain it.
**Values:** Reproducibility, explainable output, data staying on the office computer, and
clear separation between clients.
