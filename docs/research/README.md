# Research notes

This directory holds the research that TaxReporter's code is built on: the FURS eDavki XML formats (Doh-KDVP, Doh-Div, Doh-Obr, D-IFI), Banka Slovenije (BSI) exchange rates, the Slovenian tax rules the engine applies, the export formats of the brokers and equity-plan platforms our users have, and the existing tools we can learn from. It is written for contributors who build parsers, the FIFO and tax engine, the rate snapshot and the XML generators.

The research was done on 2026-10-06 and 2026-10-07 and covers tax years 2025 and 2026. Each doc carries its own dated status line and says how it was checked.

> **This is research for building the tool, not tax advice.** FURS publications (the eDavki XSDs, forms and instructions), the law (ZDoh-2, ZDavP-2, ZDDOIFI, ZINR, as published in Uradni list RS and on PISRS) and Banka Slovenije's published data always win over anything written here. If a primary source disagrees with a doc, the doc is wrong: fix it as described in [How to update a doc](#how-to-update-a-doc-when-furs-changes-something).

## Reading order

| # | Doc | What it covers | Verification |
|---|---|---|---|
| 01 | [Doh-KDVP XML format](01-furs-doh-kdvp.md) | The capital-gains return: envelope, element order, list types, F1–F11 fields, acquisition codes per list type, formatting limits, modeling rules (FIFO, partial sales, splits), import into eDavki, and a validated worked example. | adversarially verified (21 claims: 20 confirmed, 0 refuted, 1 uncertain) |
| 02 | [Doh-Div, Doh-Obr and D-IFI XML formats](02-furs-doh-div-and-others.md) | The dividend return in depth (structure, type codes, payer IDs, one record per payment, foreign tax and `ReliefStatement`, deadlines), plus the interest (Doh-Obr) and derivatives (D-IFI) schemas. | adversarially verified (22 claims: 22 confirmed, 0 refuted, 0 uncertain) |
| 03 | [BSI exchange rates](03-bsi-exchange-rates.md) | Which rate the law requires, BSI's XML/JSON sources and their quirks, weekend and holiday lookback, the monthly exotic list, the six known BSI≠ECB values, CORS, licensing, and a snapshot pipeline. | adversarially verified (20 claims: 20 confirmed, 0 refuted, 0 uncertain) |
| 04 | [Slovenian tax rules](04-si-tax-rules.md) | Rates by holding period, normed costs, FIFO, trade dates, losses and the 30-day wash-sale rule, FX, the foreign tax credit, interest, special cases (splits, INR, Revolut savings, crypto), deadlines and filing thresholds. | adversarially verified (25 claims: 25 confirmed, 0 refuted, 0 uncertain; 3 minor corrections) |
| 05 | [Prior art](05-prior-art.md) | Existing Slovenian eDavki tools (ib-edavki and others), the XML they emit, the pitfalls in their issue trackers, commercial services, reusable libraries and their licenses, and what to do differently. | not independently verified |
| 06 | [IBKR, Trading 212, Revolut exports](06-brokers-ibkr-t212-revolut.md) | Flex Query XML, T212 CSV versions, Revolut account and P&L statements: columns, action types, time zones, fees, withholding, splits, pitfalls, and a normalized event model. | not independently verified |
| 07 | [eToro, Trade Republic, XTB, DEGIRO and other brokers](07-brokers-eu-and-others.md) | Popularity ranking and export formats for the other brokers Slovenians use, CFD-vs-real routing, and domestic brokers that report to FURS themselves. | not independently verified |
| 08 | [Employee equity plans](08-brokers-equity-plans.md) | Schwab, E\*TRADE / Morgan Stanley, Shareworks, Fidelity, Computershare/EquatePlus and Carta exports, and how RSU/ESPP shares map to Doh-KDVP and Doh-Div. | not independently verified |
| 09 | [Numbers and dates in XLSX exports](09-xlsx-numbers-and-dates.md) | How a number cell (a binary double) and a date serial are read exactly: 15 significant digits, the 1900 and 1904 date systems, the time of day, and the limits Excel holds a workbook to. The source of ADR 0014's exception to ADR 0006. | not independently verified |

## Confidence and verification legend

**Status line.** Every doc starts with `Researched: <date> · Verification: …`.

- **adversarially verified (N claims: X confirmed, Y refuted, Z uncertain)**: an independent agent, which did not write the report, re-checked each of the report's N critical claims against primary sources and looked for things the report missed. Its corrections are applied in the text, and its full findings are in the doc's **Verification** section.
- **not independently verified**: a single researcher's report. The doc's **Confidence** section lists the claims the researcher rated below high confidence. Broker docs also tag statements **[H]** (primary source), **[M]** (several secondary sources) or **[L]** (single or indirect source), and 04 marks guesses *(inference)*.

**Inline markers.**

- **(corrected after verification)**: the text at that spot was changed, qualified or added because a verifier refuted it, qualified it, or found a fact missing. The Verification section says what changed. The reader should never meet the uncorrected version first.
- **(unverified — see Verification)**: the verifier could not confirm the statement. Treat it as an assumption until a primary source settles it.
- **Cross-references** such as "(confirmed in 01 §8, verified)" or "(see 01 Verification)" point from one doc to a verified doc that confirms, qualifies or contradicts a statement. Where docs disagree, the verified doc wins.
- **"Sources conflict"** notes mark places where two sources, or two of these docs, disagree and nothing yet settles it. They are deliberately left visible rather than resolved by guesswork.

**Fixtures.** The broker and equity-plan research produced synthetic sample files with real headers. They are not committed with these docs, and they must be validated against real (anonymized) exports before any parser ships.

## Key facts the code depends on

**XML generation**

1. **Doh-KDVP is still `Doh_KDVP_9.xsd`.** The root is `Envelope` in the default namespace `http://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd`, with `edp` bound to `EDP-Common-1.xsd`; its children are `edp:Header`, an optional `edp:AttachmentList`, a required (possibly empty) `edp:Signatures`, then `body` with `edp:bodyContent` and `Doh_KDVP`. Element order is enforced everywhere. ([01 §3](01-furs-doh-kdvp.md#3-envelope-namespaces-header-encoding), [01 §4](01-furs-doh-kdvp.md#4-doh_kdvp-body))
2. **FURS edits XSDs in place.** Codes J and K and the element `TaxDecreaseCooperative` were added to v9 without a version change, so vendored copies go stale. Validate against the live XSD in CI and fail when its SHA-256 or `Last-Modified` changes. ([01 §2](01-furs-doh-kdvp.md#2-primary-files-and-versions))
3. **F2 (acquisition method) means different things per list type.** B = nakup on long lists, A = nakup on short lists, and I/J/K differ between PLVP, PLVPGB and PLVPZOK. For foreign-broker data emit B, F, G or H (D or E for corporate actions) and flag I, J and K for manual handling; K marks lots transferred out of an INR. ([01 §6](01-furs-doh-kdvp.md#6-acquisition-method-codes-f2-type-typegaintype), [04 §2.3](04-si-tax-rules.md#23-income-from-an-inr-from-5-march-2026))
4. **The tax number must be enforced by us.** EDP-Common-1 lets a header without any tax number validate, but eDavki requires an 8-digit `edp:taxNumber`. ([01 §3](01-furs-doh-kdvp.md#3-envelope-namespaces-header-encoding))
5. **One inventory list per security, merged across brokers, with at least one purchase and one sale.** eDavki counts a list without both as incorrectly entered, so never emit purchase-only lists. ([01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing))
6. **Field formats.** F4/F9 are EUR **per unit** at up to 8 decimals; F5 and `ForeignTax` allow only 4 decimals and Doh-Div amounts 2. Use a dot decimal, `YYYY-MM-DD` dates and lowercase `true`/`false`. Prices exclude commission, because eDavki applies normed costs of 1% + 1%, capped at the gain and only on gains. ([01 §7](01-furs-doh-kdvp.md#7-data-formatting-rules), [04 §4.1](04-si-tax-rules.md#41-tax-base-and-normed-costs))
7. **F10 `true` means the loss may reduce the base** (settled 2026-10-07 from the navodila and the display XSLT; an omitted F10 displays as "Ne"). The wash-sale window runs 30 days on both sides of a sale and crosses the year end. ([01 §5.2](01-furs-doh-kdvp.md#52-securities-plvp-securitieswithcontract-is-the-same-plus-stockexchangename-max-30-after-isfond), [04 §5.3](04-si-tax-rules.md#53-wash-sale-rule-pravilo-navidezne-odsvojitve-art-975))
8. **Doh-Div v3 has its own shape, and its XSD is permissive.** `Dividend` elements are siblings of `Doh_Div`, and its body has no `edp:bodyContent` (Doh-Obr and D-IFI require one). A negative `Value`, `Type` 99 or country `IRL` all validate, so the app must enforce the business rules: gross EUR `Value` > 0, `Type` 1–7, the FURS country list (`EL` for Greece), and the payer fields. Omit elements that do not apply (`ForeignTax` for Slovenian payers, a D-IFI `ISIN` for instruments without one) rather than writing placeholders. ([02 §3](02-furs-doh-div-and-others.md#3-doh-div-v3-document-structure), [02 §9](02-furs-doh-div-and-others.md#9-business-rule-validation-the-app-must-add))
9. **One `Dividend` record per payment.** FURS rejected a return that summed two payments, and two records with the same `PayerIdentificationNumber` on the same date are a critical error (FURS's workaround is sequential IDs). Whether broker per-position fragments of one payment may be merged is unresolved; 02 and 07 disagree. ([02 §5](02-furs-doh-div-and-others.md#5-one-record-per-payment-and-payer-ids))
10. **Foreign tax credit and `ReliefStatement`.** Enter the foreign tax actually paid; FURS caps the credit at the treaty rate (15% for US dividends to individuals) and at the Slovenian tax, and tax above the treaty rate can only be reclaimed abroad. FURS frames `ReliefStatement` as an exemption claim, so do not fill it by default. ([02 §6](02-furs-doh-div-and-others.md#6-foreign-tax-reliefstatement-and-treaties), [04 §7.2](04-si-tax-rules.md#72-foreign-tax-credit-odbitek-tujega-davka-zdoh-2-arts-136138-zdavp-2-art-328))

**Exchange rates**

11. **BSI rates are units of foreign currency per 1 EUR, so EUR = foreign amount / rate.** Convert each leg at the rate of its own date, never at the broker's rate. A dividend and its foreign tax both use the dividend's payment date (not the ex-date). The metals on the monthly list are EUR per gram and must be rejected. ([03 §1](03-bsi-exchange-rates.md#1-tldr-for-implementers), [03 §2](03-bsi-exchange-rates.md#2-legal-basis-which-rate-furs-requires))
12. **Use the last list published on or before the date.** BSI publishes only on TARGET days. The longest real gap between consecutive lists is 5 calendar days (Easter, Christmas), so cap the lookback at 7 days and treat more as missing data. FURS has no written rule; this follows BSI's own lookup (medium confidence). ([03 §9](03-bsi-exchange-rates.md#9-weekends-holidays-and-target-closing-days))
13. **Exotic currencies (TWD, ARS and about 120 others) use BSI's monthly list**: the list whose `veljavnost` is the 1st of the transaction's month. The JSON API filters by `datum`, so select by `valid_from`; merge duplicate monthly elements. RUB after 2022-03-01 has no BSI rate at all. ([03 §5](03-bsi-exchange-rates.md#5-monthly-exotic-currency-list-eksottecbsxml), [03 §10](03-bsi-exchange-rates.md#10-currencies-not-on-the-daily-list))
14. **BSI has no CORS, so the browser app ships a snapshot.** Bundle the rates (byte-identical decimal strings, under a separate data notice), update them from a CORS-enabled mirror, and use the ECB Data Portal only as a labeled fallback for BSI's own currency set. Parse the XML (namespace `http://www.bsi.si`); the JSON API drops trailing zeros. When fetching BSI from scripts, send an explicit User-Agent ([05](05-prior-art.md#22-masbugetoro-edavki-etoro-xlsx) found BSI returning 403 to Python's default; not independently verified). ([03 §11](03-bsi-exchange-rates.md#11-http-behavior-and-cors-tested-2026-10-07-curl--si--h-origin-httplocalhost5173), [03 §13](03-bsi-exchange-rates.md#13-recommended-implementation))
15. **Six known BSI≠ECB values**: JPY 2008-10-14, HUF 2010-03-04, BGN 2013-06-24, LVL 2013-12-31, SGD 2014-02-03 and NOK 2025-10-23 (BSI 11.8529, ECB 11.5829). The statute names BSI, so default to BSI's value, warn with the ECB value, and fail CI on any new discrepancy. ([03 §8](03-bsi-exchange-rates.md#8-are-bsi-rates-identical-to-ecb-reference-rates))

**Tax rules**

16. **Rates.** Capital gains on shares, ETFs and fund units: 25% if held under 5 years, 20% from 5 years, 15% from 10 years, and exempt from 15 years (such lots are not listed at all). Dividends and interest: a flat 25% final tax. Derivatives on D-IFI: a flat 25% from tax year 2026. ([04 §2](04-si-tax-rules.md#2-tax-rates))
17. **FIFO is mandatory per taxpayer, across all brokers and accounts.** The broker's own lot matching is irrelevant; only a portfolio-management pool (PLVPGB) and fund unit classes may be tracked separately, and only optionally. ([04 §4.4](04-si-tax-rules.md#44-fifo-is-mandatory-per-taxpayer-across-brokers), [01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing))
18. **The trade date, not the settlement date,** is the acquisition and disposal date and therefore the rate date. Exceptions: INR transfers (transfer date), bonus shares (resolution date) and inheritance (date the decision became final). ([04 §4.3](04-si-tax-rules.md#43-dates-trade-date-not-settlement-date))
19. **Losses offset gains only within the same year, and there is no carry-forward** except for shares held before a bonus issue (art. 97(3), `HasLossTransfer`). A loss is disallowed if same-kind capital is acquired within 30 days before or after the sale (61-day window, matched by quantity and chronologically; the unsold remainder of the lot being sold never counts). ([04 §5](04-si-tax-rules.md#5-losses))
20. **Deadlines and e-filing.** Every return is due 28 February, moved to the next working day (ZDavP-2 art. 45(2)): 2 March 2026 for tax year 2025 and 1 March 2027 for tax year 2026 (confirm against FURS's public call). Doh-KDVP must be filed electronically above 10 transactions, and Doh-Div and Doh-Obr above 5 payments. Doh-KDVP must be filed even when there are only losses. ([04 §10](04-si-tax-rules.md#10-deadlines-filing-and-corrections))

## Open conflicts to settle before implementing

These docs disagree with each other on the points below, and no primary source read so far
settles them. The issue that implements the affected feature must settle each one with a
primary source (law text, FURS instructions, FURS FAQ, or an answer from FURS) and update
the docs in the same PR.

| Question | Where the docs disagree | Settle in |
|---|---|---|
| ~~What `true`/`false` in Doh-KDVP `Sale/F10` means for the 30-day rule~~ **Settled 2026-10-07:** `true` = the condition for the loss to reduce the base is met ("DA"), per the navodila's column 10 text and the display XSLT's `YesNo` template; an omitted F10 displays as "Ne" ([01 §5.2](01-furs-doh-kdvp.md#52-securities-plvp-securitieswithcontract-is-the-same-plus-stockexchangename-max-30-after-isfond)) | [01](01-furs-doh-kdvp.md) reads the official display (`true` shown as "Da"); [04](04-si-tax-rules.md) notes the XSD defines no meaning and existing tools disagree | Doh-KDVP export (v0.1) |
| Whether transaction taxes and broker commissions go into the acquisition or disposal value, given that normed costs (1% + 1%) replace actual costs | [06](06-brokers-ibkr-t212-revolut.md) suggests adding transaction taxes to cost; [01](01-furs-doh-kdvp.md) excludes commissions | Doh-KDVP export (v0.1) |
| Whether per-position dividend fragments of one payment are merged | [07](07-brokers-eu-and-others.md) merges eToro's per-position rows; [02](02-furs-doh-div-and-others.md) says FURS forbids summing separate payments. These are compatible if fragments of a single payment count as one payment | eToro adapter (v0.2) |
| Whether a sell-to-cover loss is disallowed by the 30-day rule | [08](08-brokers-equity-plans.md) expects it to be; [04](04-si-tax-rules.md) cites FURS examples 2, 3 and 7, where the unsold rest of the same lot is never a replacement | Equity-plan adapters |

Settled since the docs were written: RUB after 2022-03-01 has **no** BSI rate. The daily
list stops at 2022-03-01, and the full monthly history has no RUB entries (checked
2026-10-07), so the BSI doc ([03](03-bsi-exchange-rates.md)) is right. Broker columns are
always matched by header name, never by position, including localized E\*TRADE exports.

## How to update a doc when FURS changes something

The same procedure applies when BSI, a law or a broker export changes.

1. **Re-verify against the primary source.** Download the live XSD, form, instructions or law text, and record its URL, the date checked, its `Last-Modified` header and, for XSDs, its SHA-256. A secondary source alone is not enough; if nothing better exists, add the change marked "(unverified — see Verification)".
2. **Keep the dated status line.** Never change the original `Researched:` date. Append `· Updated: YYYY-MM-DD (what changed)`, and if the change was re-verified, add the new verification counts.
3. **Never silently overwrite a corrected fact.** A statement marked "(corrected after verification)" changes only with new primary evidence. Add a dated note that cites the evidence, keep the superseded fact visible (for example "until 2026-08 the XSD did not allow K"), and update the Verification section.
4. **Keep history for formats.** Add a row for a new XSD edit or a new broker header version; do not replace the old one, because users still hold old exports.
5. **Update everything that depends on the fact in the same change:** the key facts above, the code, the tests and the fixtures. This follows the project rule that docs and tests go in the same commit as the code change.
6. **Close open questions explicitly.** When a question is answered, say where and how, rather than deleting it.

Local research artifacts (downloaded files, scripts, synthetic fixtures) were not committed. Each doc's **Sources** section lists the public URLs that the facts come from.
