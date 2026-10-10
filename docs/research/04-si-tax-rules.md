# Slovenian personal income tax on capital gains and dividends (tax years 2025 and 2026)

> Researched: 2026-10-07 · Verification: adversarially verified (25 claims: 25 confirmed, 0 refuted, 0 uncertain; 3 minor corrections) · Updated: 2026-10-09 (open question on rights handed out free to holders; takeovers and mergers paid in shares, §9.1, from primary sources, not independently verified; cash for a fraction of a spin-off share counted as a dividend, §9)
>
> Research for building TaxReporter. It is not tax advice, and FURS publications and the law win over anything written here. Inline markers are explained in the [README](README.md#confidence-and-verification-legend).

**Scope.** Covers tax year 2025 (filed by 2 March 2026) and tax year 2026 (filed in Jan–Feb 2027).

**Audience.** TaxReporter contributors who implement Doh-KDVP (capital gains) and Doh-Div (dividends) generation for Slovenian residents who use foreign brokers. The XML formats themselves are in [01](01-furs-doh-kdvp.md) and [02](02-furs-doh-div-and-others.md); exchange rates are in [03](03-bsi-exchange-rates.md).

Every rule below links to a primary source. Anything marked *(inference)* or *low confidence* still needs verification before code depends on it.

Abbreviations: **ZDoh-2** = Zakon o dohodnini (Personal Income Tax Act). **ZDavP-2** = Zakon o davčnem postopku (Tax Procedure Act). **ZDDOIFI** = Act on tax on gains from disposal of derivatives. **ZINR** = Act on individual investment accounts. **FURS** = Finančna uprava RS. **BSI** = Banka Slovenije. **UL** = Uradni list RS.

Primary texts used:

- ZDoh-2 consolidated text in force from 1 January 2025 (racunovodstvo.net mirror; canonical copy at pisrs.si ZAKO4697)
- FURS detailed description *"Obresti, dividende, dobiček iz kapitala in dohodek z INR"*, **15th edition, August 2026**
- FURS wash-sale explanation (*pravilo navidezne odsvojitve*)
- FURS derivatives brochure, July 2026
- eDavki form instructions `doh_odm_kdvp_25` and `doh_odm_div`, dated 11 March 2026. Note (corrected after verification): the eDavki Doh-Div page currently links `doh_odm_div20.n.sl.pdf` (modified 30 Mar 2026) as the instructions for 2020, 2021 and 2023+; `doh_odm_div.n.sl.pdf` (modified 11 Mar 2026) is not linked from that page, and the 2022 set links `doh_odm_div.i` + `doh_odm_div22.n`. The wording on codes, FX and e-filing is the same in both.
- FURS public calls to file for 2024 and 2025

The verifier checked the statutes against the PISRS consolidated texts: ZDoh-2 NPB 34 (11 Dec 2024–18 Jul 2025), NPB 35 (19 Jul 2025–4 Mar 2026) and NPB 36 (from 5 Mar 2026), and ZDavP-2 NPB 32 (from 2 Jul 2026).

---

## 1. What changed in 2025 and 2026

For shares, ETFs and fund units taxed under ZDoh-2, **the rates and core rules are the same in 2025 and 2026**. They have stood since ZDoh-2Z took effect on 1 January 2022. The changes that matter to this project are around the edges:

| Act | Published | Applies from | What it changes for this project |
|---|---|---|---|
| ZDoh-2Z | UL 39/2022 | 1 Jan 2022 | Capital-income rate back to 25% (it was 27.5% in 2020–2021). Capital gains become exempt after 15 years of holding (was 20). |
| ZDoh-2AA | UL 158/2022 | 2023 | Removes the 2022-only option to include capital income in the annual progressive tax base. Capital income is a final (*dokončen*) tax again. |
| ZDoh-2AB | UL 104/2024 (10 Dec 2024) | 1 Jan 2025 | Special regime for employee shares in innovative start-ups (art. 45.b). New basis rule art. 98(10). New Doh-KDVP acquisition code **J**. The 5-year loss limit in this act applies to **business** losses, not capital gains. |
| ZINR | UL 40/2025 (4 Jun 2025) | in force 5 Jun 2025; applies from **5 Mar 2026** | Creates the **individual investment account (INR)**: new ZDoh-2 chapter III.6.4 (arts. 104.a–104.č) and a 15% rate added as art. 132(3). The live `Doh_KDVP_9.xsd` also gained acquisition code **K** for transfers out of an INR (corrected after verification; see §2.3). |
| ZDDOIFI-B | UL 85/2025 (6 Nov 2025) | tax year **2026** | Derivatives, CFDs, ETCs and ETNs move to a **flat 25%**. The holding-period scale and the 20-year exemption are deleted. |
| ZLZD (worker-ownership co-ops) | UL 85/2025 | 1 Jan 2026 | Adds the Doh-KDVP flag `TaxDecreaseCooperative`. Not relevant to foreign brokers. |
| ZDavP-2P | UL 100/2025 (4 Dec 2025) | 1 Jan 2026 | New art. 326(8): **interest and dividend returns must be filed electronically when there are more than five payments** in the year. Also transposes DAC8 (crypto-asset reporting). |
| ZUDDob-1 (employee profit sharing) | adopted 11 Feb 2026 | 11 Mar 2026 | Basis rule for shares received under this act (FURS Q18). Domestic employers only. |

**Not changed:**

- The **crypto** gains tax bill (25%, government approved July 2025) was pulled from the December 2025 session of the National Assembly. Crypto *disposal gains* of individuals outside a business activity therefore stay untaxed for 2025 and 2026 (see §9). This does not make all crypto receipts tax-free (corrected after verification): FURS taxes crypto mining income as "drugi dohodek" (25% advance tax, part of the annual base), and crypto trading carried on as a business is business income. Do not assume staking or other crypto receipts are tax-free either.
- A bill filed on 22 Sep 2026 reworks the progressive income tax brackets from 2027. It does not touch capital income.

---

## 2. Tax rates

### 2.1 Capital gains on shares, ETFs, fund units and company holdings (ZDoh-2 arts. 96, 132)

| Holding period at disposal | Rate, 2025 and 2026 (since 2022) | 2020–2021 | Until 2019 |
|---|---|---|---|
| Under 5 completed years | **25%** | 27.5% | 25% |
| 5 or more, under 10 completed years | **20%** | 20% | 15% |
| 10 or more, under 15 completed years | **15%** | 15% | 10% |
| 15 years or more | **exempt** (art. 96(1)) | 10% (15–20 y) | 5% (15–20 y) |
| 20 years or more | exempt | exempt | exempt |

Legal wording:

- Art. 132(1): *"po stopnji 25 % in se šteje kot dokončen davek"* (at a rate of 25%, treated as a final tax).
- Art. 132(2): *"po dopolnjenih petih letih imetništva kapitala: 20%, desetih letih imetništva kapitala: 15%"* (after five completed years of holding: 20%; after ten: 15%).
- Art. 96(1): *"Dohodnine se ne plača od dobička iz kapitala, doseženega pri odsvojitvi kapitala po 15 letih imetništva"* (no income tax on a gain from a disposal after 15 years of holding).

Gains on debt securities are also exempt (art. 96(2)(4)). Their interest is taxed separately (§8).

ZDoh-2 art. 2: the law in force on 1 January of the tax year applies.

The tax is computed by FURS. The Doh-KDVP XML carries dates, quantities and per-unit values only, so the tool does not decide the rate. It does need to compute the rate for previews and for the split described in §4.6.

### 2.2 Dividends and interest

- **25% final tax** (art. 132(1)). This rate has applied to income received from 1 Jan 2022 (27.5% in 2020–2021, 25% from 2013 to 2019).
- No holding-period reduction applies to dividends; the reduction in art. 132(2) applies only to "dobiček iz kapitala".
- No de-minimis threshold exists for dividends. The only de-minimis is the EUR 1,000 deposit-interest filing exemption (ZDavP-2 art. 326(2)).
- Interest has a EUR 1,000 allowance for **deposits at Slovenian or EU banks only** (§8).

### 2.3 Income from an INR (from 5 March 2026)

- Return paid out of an INR is taxed at **15%** (art. 132(3)). The INR provider withholds it (art. 135.a).
- A payout is exempt if made at least 15 years after the account was opened (with no earlier payout), or 15 years after the previous payout (art. 104.b).
- Trades and dividends inside an INR are **not** reported on Doh-KDVP or Doh-Div; interest, dividends and gains on INR assets are taxed only as INR income (arts. 81(6), 90(5), 92(2)), and FURS says no return is filed for INR income (FURS opis 5.4).
- **Exception** (corrected after verification): income on INR assets earned while the INR is dormant (*mirovanje*, for example after the holder stops being resident) or after it is closed is taxed as if it were not INR income (FURS opis 5.3). It then belongs on the ordinary Doh-Div, Doh-KDVP and Doh-Obr returns.
- If instruments are moved from an INR to an ordinary trading account, then for later Doh-KDVP purposes:
  - the acquisition date is the **transfer date** (art. 101(7));
  - the acquisition value is the value used when computing INR income (art. 98(11));
  - the acquisition method code is **K** (corrected after verification). `Doh_KDVP_9.xsd` (Last-Modified 6 Aug 2026) has codes A–K, where K is the transfer of securities or fund units from an INR to the taxpayer's trading account; the 2025 paper form (Uradni list 107/2025) lists only A–J. On PLVPGB lists the 2026 legend uses I for the same transfer, so see [01 §6](01-furs-doh-kdvp.md#6-acquisition-method-codes-f2-type-typegaintype) before emitting either code.

### 2.4 Contrast: derivatives under ZDDOIFI, filed on Doh-IFI, not Doh-KDVP

(Doh-IFI is the D-IFI form in eDavki, schema `D_IFI_4.xsd`; see [02 §11](02-furs-doh-div-and-others.md#11-d-ifi-derivatives-d_ifi_4xsd).)

| Tax year | Rate |
|---|---|
| 2026 onward | flat **25%** |
| 2020–2025 (ZDDOIFI-A) | 40% (held under 12 months), 27.5% (12 months to 5 years), 20%, 15%, 10%, exempt after 20 years. This scale applied from 2020 to 2025, not to all years before 2026 (corrected after verification). |

Source: ZDDOIFI-B, FURS IFI brochure July 2026.

FURS treats these as derivatives: options, futures, CFDs (including rolling-spot forex), certificates, spread bets, and **ETCs and ETNs**. ETCs and ETNs count as derivatives because they are debt securities whose return is not paid as coupons or discount (ZDDOIFI art. 8(1)).

Derivative losses **cannot** be offset against ZDoh-2 capital gains, and ZDoh-2 losses cannot be offset against derivative gains (ZDDOIFI art. 11(4)).

Further derivative rules (corrected after verification):

- **Leveraged trading uses normed costs of 0.25% + 0.25%**, not the 1% + 1% of ZDoh-2 (ZDDOIFI art. 11(1)).
- **CFD financing income and "dividend adjustments"** are taxed as interest under ZDoh-2 art. 81 (Doh-Obr), not on Doh-IFI (FURS IFI brochure, July 2026, section 6).
- **Futures bought and settled in crypto** (for example BTC/USDT) are not derivatives under ZTFI-1, so they are not Doh-IFI items; they are taxed only within a business activity.

---

## 3. Which return does each instrument go to?

| Item from a broker export | Return / treatment | Basis |
|---|---|---|
| Shares, ADRs, REIT shares, UCITS ETFs and other fund units/shares | **Doh-KDVP**, inventory list `PLVP` (`IsFond=true` for funds; tools differ on this flag, see [01 Open questions](01-furs-doh-kdvp.md#open-questions)) | ZDoh-2 art. 93 |
| Short sale of shares | Doh-KDVP, list `PLVPSHORT` | KDVP instructions §12 |
| Securities under a discretionary management contract | Doh-KDVP, `PLVPGB` (may be FIFO'd separately) | art. 103(2) |
| Share-capital reduction with an unchanged number of shares | Doh-KDVP, separate list `PLVPZOK`; later sales use the reduced unit cost in `F11` (corrected after verification) | Doh_KDVP_9.xsd; [01 §5.4](01-furs-doh-kdvp.md#54-shares-pld-and-securitiescapitalreduction-plvpzok) |
| Foreign tax paid on a capital gain | Doh-KDVP `HasForeignTax`/`ForeignTax` (form field "Davek, plačan v tujini DA/NE") (corrected after verification) | ZDavP-2 art. 328(1) covers all capital income |
| Bonds: gain on sale | exempt, not reported | art. 96(2)(4); KDVP instructions §1 |
| Bonds: coupons and discount | Interest return (Doh-Obr / DOHKAP št. 1) | arts. 81, 88 |
| ETCs, ETNs, options, futures, CFDs, certificates | **Doh-IFI** (ZDDOIFI) | FURS IFI brochure |
| CFD financing income and dividend adjustments | Doh-Obr, as interest (corrected after verification) | ZDoh-2 art. 81; FURS IFI brochure §6 |
| Cash dividends from a foreign payer | **Doh-Div** | art. 90; ZDavP-2 art. 326 |
| Fund distribution | Doh-Div, type code **4**. If the fund distributes income *as interest*, it is interest under art. 81. | art. 90(4)(3), art. 81 |
| Broker interest on cash (IBKR, eToro, …) | Doh-Obr, 25%, **no** EUR 1,000 allowance | FURS Q&A 6.2 Q20, Q24 |
| Savings interest at an EU bank (Revolut Bank UAB *Instant Access Savings*, N26, bunq, Trade Republic after 6 Dec 2023) | Deposit-interest return; EUR 1,000 allowance | art. 133; FURS Q19–Q25 |
| Revolut *Savings Flexible Account* (a money-market fund held via Revolut Securities Europe UAB) | Its "interest" is **fund interest** under art. 81(1): Doh-Obr, 25%, **no** EUR 1,000 allowance. In addition, every fund-unit purchase, reinvestment and redemption must be listed on **Doh-KDVP**, even at zero gain (corrected after verification) | FURS Q18/Q18a |
| Spot FX gains on cash balances | not taxable for individuals (not "capital"; spot FX is not a derivative) | art. 93; IFI brochure 4.b |
| Crypto (outside business activity) | disposal gains not taxed in 2025/2026; mining income and business trading are taxed (§1) | see §9 |
| INR holdings | excluded; withheld by the provider, except income earned while the INR is dormant or after it is closed (§2.3) | ZINR |

Foreign brokers without a Slovenian branch do **not** report trades to FURS. The Doh-KDVP pre-fill comes only from entities required to report under ZDavP-2 art. 339(1): Slovenian residents, or non-residents with a Slovenian branch. Capital income is also not part of the annual *informativni izračun* (pre-filled annual assessment, art. 267), because it is a final tax. **For foreign brokers, the taxpayer files everything.** FURS Q&A 6.1 Q12 states this explicitly for eToro and Interactive Brokers.

---

## 4. Computing a capital gain (ZDoh-2 arts. 97–103)

### 4.1 Tax base and normed costs

Art. 97(1): the base is *value at disposal − value at acquisition*. **Only when that difference is positive**, it is reduced by normed costs (*normirani stroški*). The deduction is capped at the **lower** of:

1. 1% of the acquisition value **plus** 1% of the disposal value, or
2. the positive difference itself.

So normed costs can reduce a gain to zero but never create or enlarge a loss. FURS: *"Normirani stroški se ne priznavajo v primerih, ko je pri odsvojitvi realizirana izguba"* (normed costs are not recognized where the disposal realizes a loss). This regime applies to disposals from 1 Jan 2020. Before that, 1% was added to cost and 1% deducted from proceeds without the cap.

Examples:

- Buy 1,000.00, sell 1,200.00: difference 200.00; normed costs min(10.00 + 12.00, 200.00) = 22.00; base **178.00**. This matches the FURS English page example.
- Buy 1,000.00, sell 1,010.00: normed costs min(20.10, 10.00) = 10.00; base **0.00**.

eDavki computes this itself. Implement it identically only for previews. Apply it per matched disposal lot *(inference: FURS examples are per disposal)*. Derivatives use different normed costs when leveraged (§2.4).

### 4.2 Acquisition value, disposal value, fees

- **Acquisition value** = the value stated in the purchase or other contract (art. 98(2)).
  - From 2020 the only recognized add-ons for securities are inheritance and gift tax paid and, for company shares, subsequent shareholder contributions (art. 98(7); FURS opis §4.2).
  - Broker commissions, exchange fees, FX-conversion spreads and financing costs are **not** separately deductible. FURS: *"splošno izhodišče … podobno kot velja po ZDoh-2 … da se dejanski stroški … ne priznavajo"* (as under ZDoh-2, actual costs are generally not recognized; IFI brochure §6.1). Costs are compensated only through the 1% + 1% normed costs. FURS Q&A 6.2 Q18a (Revolut fund example) also leaves a EUR 12 fee out of the gain computation.
  - Recommendation: use **price × quantity, excluding separately charged commission**. Prior art (jamsix/ib-edavki) uses `tradePrice` the same way.
- **Disposal value** = the contract value. If the contract price does not match a free-market price, the comparable market price is used instead (art. 99(1)). For shares exchanged in a takeover or merger, see §9.1.
- **Gift or inheritance:** the acquisition value is the value on which inheritance/gift tax was assessed. If no tax was assessed, it is the comparable market price at acquisition (art. 98(2)).
- **Employee shares (RSU/ESPP/options):** the fringe benefit is employment income on the exercise or acquisition date (art. 43(4)). The capital-gains basis is the **comparable market price on that day** (art. 98(3)). The Doh-KDVP instructions repeat this for discounted employee purchases. Platform exports and code choices are in [08](08-brokers-equity-plans.md).

### 4.3 Dates: trade date, not settlement date

- Time of acquisition and time of disposal = *"datum sklenitve pogodbe ali drugega pravnega posla"*, the date the contract or other legal transaction was concluded (arts. 101(1), 102). For exchange trades this is the **trade date**. Settlement date is not used. For shares exchanged in a takeover or merger, see §9.1.
- Gains are realized in the tax year of the disposal (art. 104).
- Bonus shares from a capital increase out of company funds: the acquisition date is the date of the shareholder resolution (art. 101(6)).
- Inheritance: the acquisition date is the date the inheritance decision became final (*pravnomočnost sklepa o dedovanju*), not the date of death (art. 101(1); FURS Q&A 6.3).
- INR transfers: the acquisition date is the transfer date (art. 101(7), from 5 Mar 2026; §2.3).
- **Moving to Slovenia** (corrected after verification). Becoming a Slovenian resident does **not** reset the acquisition **date** (FURS Q&A 6.1 Q13). The acquisition **value** can change, however: where Germany charged exit tax, the acquisition value is the fair market value used for the German exit tax (SI–DE treaty art. 13(5)), plus any unclaimed art. 98(7) costs. The tool therefore needs a per-lot basis override for such cases. (The original report stated that there is no step-up on immigration at all.)

### 4.4 FIFO is mandatory, per taxpayer, across brokers

Art. 103(1): *"Zavezanec je dolžan voditi evidenco zalog istovrstnega kapitala … po metodi zaporednih cen (FIFO)."* (The taxpayer must keep an inventory of same-kind capital using FIFO.) The obligation sits with the **taxpayer**, not the account.

All lots of the same security held at all brokers form one FIFO queue, with only these exceptions, both optional:

- securities under a portfolio-management contract with a brokerage may be tracked separately (art. 103(2), list `PLVPGB`);
- fund units may be tracked separately per unit class (art. 103(3)).

Lots transferred out of an INR join the queue with the transfer date and value (arts. 98(11), 101(7)).

The form supports this. The instructions require one inventory list per security ("ločeno za vsako vrsto vrednostnega papirja"). eDavki merges imported `PLVP` transactions into an existing list for the same security, while `PLVPGB` imports create a new list (eDavki help, import of inventory lists).

*Ambiguity:* the law says "same-kind" (*istovrstni*). Using ISIN as the identity key is the practical choice, but ISIN changes after corporate actions need explicit linking.

*Lots bought on the same day.* Art. 103(1) orders lots by when they were acquired. FURS gives no worked example for two lots bought on one day. Where an export records the time of each trade (Trading 212 to the second, in UTC), that time decides which lot is first. Where it does not, the order of that day's lots is unknown. The tool then picks a fixed order and warns when that order decided which lot a sale used (ADR 0011 §7).

### 4.5 Holding period

The holding period runs from the acquisition date to the disposal date. The text says "po dopolnjenih petih letih" (after five completed years). FURS publishes no worked example of the boundary day; see open questions. Under FIFO each matched lot has its own holding period, so one sale can fall into several rate buckets.

### 4.6 Several holding-period buckets in one year (art. 97(4))

After losses are offset, the remaining total positive base is **allocated pro rata** to holding-period buckets in proportion to each bucket's positive base ("pozitivna davčna osnova posameznega obdobja imetništva / seštevek pozitivnih davčnih osnov"). Each bucket is then taxed at its rate.

Example (the verifier checked the arithmetic):

- Gains: +1,000 (held under 5 years) and +500 (5–10 years). Losses: −600.
- Net base: 900.
- Allocation: 600 at 25% and 300 at 20%.
- Tax: **210**.

---

## 5. Losses

### 5.1 Offsetting within the year

A loss reduces positive bases from disposals of **any** ZDoh-2 capital in the same year ("v letu, za katero se odmerja dohodnina"): securities, company holdings, fund units, and also real estate (art. 97(2)). The real-estate cross-offset is claimed through Doh-KDVP section 6.

Losses never offset dividends, interest or Doh-IFI derivative gains.

### 5.2 No general carry-forward

FURS Q&A 6.1 Q4: *"Prenos neizkoriščenih izgub v naslednja davčna obdobja ni mogoč."* (Unused losses cannot be carried into later tax periods.)

The **only** exception is art. 97(3): a loss on shares acquired **before** bonus shares were received from a capital increase out of company funds may be carried forward, oldest first.

- On the inventory list it is flagged by `HasLossTransfer` ("Prenos izgube po tretjem odstavku 97. člena").
- It is claimed in later years in Doh-KDVP section 5 (`TaxBaseDecrease`), quoting the decision number and date.

There is no 5-year (or other) general carry-forward for capital losses. The 5-year limit in ZDoh-2AB concerns business income.

### 5.3 Wash-sale rule (*pravilo navidezne odsvojitve*, art. 97(5))

A loss on securities, holdings or fund units does **not** reduce the positive base if either:

1. within **30 days before or after** the disposal, the taxpayer acquires *substantively same-kind replacement capital* (*vsebinsko istovrstni nadomestni kapital*), or acquires a right or obligation to buy same-kind capital (for example an option or a future); or
2. the taxpayer disposes and a **family member**, or a legal entity in which the taxpayer holds at least 25% (by value or votes), directly or indirectly acquires same-kind capital.

The 30-day window is written only into point 1. Point 2 has no statutory window, so how to date-bound the related-party trigger is a design decision to confirm with the user or FURS (corrected after verification).

"Family member" here means spouse or extramarital partner, children (including adopted children, stepchildren and the partner's children), parents and adoptive parents, and registered same-sex partners and their children (art. 16(7)).

FURS interpretation (2015 explanation, 1st edition, still published):

- The window is **61 days**: the disposal day plus 30 days before and 30 days after.
- The rule applies **only to losses**. The disallowed part of the loss is treated as a **zero base**.
- It does **not** change acquisition values, disposal values or holding periods of either the old or the replacement capital. The disallowed loss is **not added to the replacement shares' basis**, unlike the US rule.
- "Replacement" is measured **by quantity**. Buying more replacement shares than were sold is irrelevant beyond the quantity sold.
- If one disposal sells **all** shares, including those bought inside the window before it, so the remaining stock is zero, the whole loss is allowed (FURS examples 14, 18). Purchases made **after** the sale inside the window still disallow the loss (FURS examples 9, 20, 21).
- Several loss disposals are processed **chronologically**. Each acquisition inside the window can serve as replacement only once (FURS examples 11, 16, 17, 19).
- **The unsold remainder of the lot being sold is never replacement capital**, even if that lot was bought within the 30 days before the sale (FURS examples 2, 3 and 7) (corrected after verification). The original report inferred from example 17 that "acquisitions on the same day as the lot being sold are not treated as replacement"; the verifier's reading of the examples is "same-lot remainder excluded".

**Doh-KDVP column 10 (`Sale/F10`).** The instructions say *"»DA«, če je izpolnjen pogoj za zmanjšanje pozitivne davčne osnove, oziroma »NE«, če pogoj ni izpolnjen"*. That is, YES means the loss **may** reduce the base. **The XML true/false meaning was settled on 2026-10-07 as `true` = the loss may reduce the base**, from the navodila and the display XSLT, both re-read and pinned by SHA-256 ([01 §5.2](01-furs-doh-kdvp.md#52-securities-plvp-securitieswithcontract-is-the-same-plus-stockexchangename-max-30-after-isfond)). An eDavki import test is still to confirm it once the 2026 form opens in January 2027. The evidence, as first verified:

- `Doh_KDVP_9.xsd` (modified 6 Aug 2026) declares F10 as an optional `xs:boolean` documented only as "Pravilo iz drugega odstavka v povezavi s petim odstavkom 97.člena ZDoh-2", with no published true/false semantics.
- Prior-art tools disagree: t212-edavki hardcodes `true`; LazyFURS, brrr-generator (`satisfiesTaxBasisReduction`, left unfinished in its code) and mp_tax-generator hardcode `false`.
- The instruction wording supports `true` = the loss may reduce the base, and the Doh-KDVP research found that the official display XSLT shows `true` as "Da" in column 10 ([01 §5.2](01-furs-doh-kdvp.md#52-securities-plvp-securitieswithcontract-is-the-same-plus-stockexchangename-max-30-after-isfond), [01 §7](01-furs-doh-kdvp.md#7-data-formatting-rules)). An eDavki import test is still needed before code depends on it.

**Implementation:** encode all 23 FURS examples as golden tests. The family-member and 25%-entity triggers cannot be detected from broker data and must be asked of the user.

### 5.4 Losses on exempt disposals

A loss on a disposal that would be exempt does not reduce the base (art. 96(3)). This covers holdings over 15 years, first disposals of privatization shares, and similar cases. Disposals after 15 years are left off the inventory list altogether: the Doh-KDVP instructions (modified 14 Jan 2026) start column 1 "z datumom prve pridobitve vrednostnega papirja …, ki je bil odsvojen pred potekom petnajstih let od dneva pridobitve".

---

## 6. Currency conversion

| Amount | Rule | Legal basis |
|---|---|---|
| Acquisition value and costs in foreign currency | BSI-published rate valid on the **acquisition date** (or the date the cost arose) | ZDoh-2 art. 98(9) |
| Disposal value | BSI rate valid on the **disposal date** | art. 99(3) |
| Dividends, interest, other income | BSI rate valid on the day the income is obtained (*dan pridobitve dohodka*); Doh-Div uses the dividend receipt date | art. 16(6); Doh-Div instructions |
| Foreign tax on a dividend | BSI rate on the dividend receipt date | Doh-Div instructions |
| Derivatives | BSI-published **ECB reference rate** on the acquisition or disposal date | IFI brochure §6.2 |

- BSI's daily table *is* the ECB reference rate set ("Dnevna tečajnica – referenčni tečaji ECB"). It is published after 16:15 on each TARGET working day.
- **Not every BSI rate is an ECB rate** (corrected after verification). The statute says "tečaj, ki ga objavlja Banka Slovenije", and BSI also publishes a monthly table for currencies the ECB does not quote, so "ECB reference rate" is not universal. The verifier gave RUB after 1 Mar 2022 as an example; **that example is wrong**: the full BSI monthly history (`EksotTecBS-l.xml`, checked 2026-10-07) contains zero RUB entries, and the daily list stops at 2022-03-01, so BSI publishes no RUB rate after that date and points users to the European Commission's InforEuro rates instead ([03 §10](03-bsi-exchange-rates.md#10-currencies-not-on-the-daily-list)). Use TWD, ARS and the other monthly-list currencies as the examples.
- BSI states *"Devizni tečaji nimajo predpisanega obdobja veljave"* (exchange rates have no prescribed validity period).
- **No FURS primary text was found** for weekends and holidays. Prior art (ib-edavki) falls back to the most recent earlier published rate, and BSI's own lookup does the same ([03 §9](03-bsi-exchange-rates.md#9-weekends-holidays-and-target-closing-days); medium confidence).
- Convert each leg separately at the BSI rate. The broker's own conversion rate is irrelevant.
- Bulgaria adopted the euro on 1 Jan 2026 (BGN 1.95583), so there is no BGN rate after that date.

---

## 7. Dividends and the foreign tax credit

### 7.1 What is a dividend

Dividends are any distribution to a holder on the basis of an ownership stake that does not reduce the stake. This includes distributions in the form of shares (art. 90(1)–(3)). Fund distributions are dividends unless distributed as interest (art. 90(4)(3), art. 81).

Doh-Div `Type` codes:

| Code | Meaning |
|---|---|
| 1 | Ordinary dividend |
| 2 | Hidden profit distribution |
| 3 | Profit-participating debt instruments |
| 4 | Fund profit or income distribution |
| 5 | Return of a subsequent contribution |
| 6 | Earn-out payments |
| 7 | Payout in an own-share buyback that is **not** on an organized market |

Code 7 is taxed as a dividend, with an optional deduction of acquisition cost determined by **LIFO** (art. 90(4)(6); CorpData block; ZDavP-2 art. 329.b). Buybacks on an organized market are ordinary capital-gains disposals. ZDoh-2Z had deleted art. 90(4)(6) for 2022, but it is back in the current text.

The tax base is the **gross** dividend (art. 91). Report it to two decimals in EUR.

**Required Doh-Div fields** (corrected after verification): payer name, payer address and payer country ("Država izplačevalca") are mandatory and separate from the source country ("Država vira", which FURS says is evident from the ISIN). `ForeignTax` is mandatory for non-Slovenian payers. See [02 §3.4](02-furs-doh-div-and-others.md#34-dividend-record), which also notes that ISIN prefixes such as XS, EU or KY do not reliably give the source country.

Dividends reinvested abroad (DRIP) and dividends received in kind must still be declared (FURS opis §3.3; 2025/2026 public calls). Reinvested shares are a new acquisition at the reinvestment price.

### 7.2 Foreign tax credit (*odbitek tujega davka*, ZDoh-2 arts. 136–138; ZDavP-2 art. 328)

- The credit may not exceed the **lower** of:
  - (a) foreign tax that is final and actually paid, or
  - (b) Slovenian tax on that foreign income (art. 137(1)).
- **With a tax treaty, "final" foreign tax means tax at the treaty rate** (art. 137(2)) (corrected after verification). Tax withheld above the treaty rate is therefore never creditable; it can only be refunded by the source state.
- **Art. 137(3) is about the other cap** (corrected after verification): where the foreign tax exceeds the Slovenian tax (point (a) above point (b)), that excess cannot be used in earlier or later periods. The original report attributed the treaty-rate excess to 137(3).
- What to enter: the Doh-Div XML guide says to enter the foreign tax **actually paid**; FURS applies the cap (corrected after verification).
- Evidence (*dokazila*): documents from the foreign tax authority, or other documents that unambiguously prove the foreign tax (ZDavP-2 art. 328(1)–(2)).
  - Broker tax statements are the usual evidence in practice.
  - Evidence may be filed later. If it is missing at the decision date, FURS issues a provisional decision (art. 328(3)–(4)).
  - A treaty credit can also be claimed in an appeal (art. 328(6)).
- Doh-Div instructions say to enter "the amount of foreign tax paid" (`ForeignTax`) and the source country (`SourceCountry`), taken from the ISIN prefix.

### 7.3 United States

US–Slovenia treaty, Article 10 (corrected after verification):

- **15%** on dividends in all cases that do not qualify for the 5% rate (art. 10(2)(b)). **An individual is always capped at 15%.**
- **5%** only when the beneficial owner is a **company** that directly owns at least 25% of the voting stock (art. 10(2)(a)). It never applies to individuals.
- RIC dividends are always 15%. REIT dividends get 15% only within the art. 10(3) limits (for example an individual with at most a 10% interest, or a publicly traded class with at most 5%).

Sources: Senate Treaty Doc. 106-9; IRS treaty text and Treasury explanation.

Example: dividend of 100 USD at 1.10 USD/EUR = 90.91 EUR.

| Case | US withholding | Slovenian tax (25%) | Credit | Payable in SI | Lost |
|---|---|---|---|---|---|
| W-8BEN on file | 15 USD = 13.64 EUR | 22.73 | **13.64** | **9.09 EUR** | 0 |
| No W-8BEN (30% withheld) | 27.27 EUR | 22.73 | still **13.64** | **9.09 EUR** | 13.64 EUR, unless reclaimed from the IRS |

So with ZDoh-2 art. 137(2), the creditable US tax is capped at 15% even if 30% was withheld, and the Slovenian top-up is 25% − 15% = 10% of the gross dividend.

---

## 8. Interest

- Rate 25%. Interest is taxed when received.
- **EUR 1,000 allowance:** the combined base of interest on **deposits at Slovenian or EU banks** (and savings banks) is reduced by EUR 1,000 (art. 133). For 2024–2026 this pool also includes interest on Slovenian government securities issued in 2024–2026 to individuals only (ZORZFS; for 2025, RS94).
- No deposit-interest return is needed if the total is EUR 1,000 or less (ZDavP-2 art. 326(2)).
- Interest from non-banks (IBKR Ireland or Central Europe, eToro, Mintos, …) is fully taxed on Doh-Obr (FURS Q24).
- Trade Republic interest counts as EU-bank deposit interest only from 6 Dec 2023 (FURS Q20–Q22). It is not exempt as current-account interest.
- **Revolut has two "savings" products with different treatment** (corrected after verification):
  - *Instant Access Savings* at Revolut Bank UAB is deposit interest in the EUR 1,000 pool (FURS Q19).
  - The *Savings Flexible Account* is a money-market fund held via Revolut Securities Europe UAB. Its "interest" is fund interest under art. 81(1), taxed at 25% on Doh-Obr with **no** allowance, and every fund-unit purchase, reinvestment and redemption must also be listed on Doh-KDVP, even at zero gain (FURS Q18/Q18a).
- **Transaction-account interest** (corrected after verification). Art. 82(2) exempts interest on a positive transaction-account balance at a payment service provider, up to that provider's sight-deposit rate. FURS Q22 says Slovenian residents' Trade Republic accounts do not qualify, because no payment services are offered to them. Current-account interest from other EU banks needs the same test before it is routed to the EUR 1,000 pool or treated as exempt.

---

## 9. Special cases

| Case | Treatment | Confidence |
|---|---|---|
| **Split / reverse split** (same issuer, share capital unchanged) | Not a disposal (art. 95(6)); cash in lieu is a partial disposal. Original dates and total cost carry over. | high (carry-over is standard practice; prior art adjusts quantity and price) |
| **ISIN/ticker change**, exchange of same-kind securities of the same issuer with no change in capital and no cash | Not a disposal (art. 95(5)) | high |
| Preferred shares converted to common, same issuer | Not a disposal; cash is a partial disposal (art. 95(7)) | high |
| **Bonus shares** from capital increase out of company funds | Basis **0**, acquisition date = resolution date (arts. 98(4), 101(6)); code `D`; enables the art. 97(3) loss carry-forward | high |
| **Stock / scrip dividends** (shares instead of cash) | Art. 90(3) taxes "razdelitev v obliki delnic" as a dividend. Telling a foreign stock dividend apart from a bonus issue is unclear. | **low**: needs review |
| **Mergers / share-for-share exchanges** | Exchange = disposal (art. 94), valued at the market price. Deferral only for an EU transaction that ZDDPO-2 recognizes, notified by the company for all its shareholders (art. 100(2)(2); ZDavP-2 art. 331(5), with arts. 380, 381). Deferred EU exchanges are flagged with `ForeignTransfer` ("Directive 90/434/EGS"). See §9.1. | high (disposal), medium (valuation, date) |
| **Spin-offs** | No clear rule for foreign cases. FURS treats a split-off funded from capital reserves as a dividend (art. 90(3)) unless deferral applies. **Cash paid instead of a fraction of a spin-off share** is counted as an ordinary dividend, the simplest reading of art. 90(1), at the owner's decision on 2026-10-09; the alternative is a partial disposal, as for cash in lieu on a split (art. 95(6)). The reader warns on each such row. | **low** |
| **Return of capital** | Payout on a share-capital reduction = (partial) disposal (art. 94). A reduction with an unchanged number of shares goes on the separate `PLVPZOK` list, and later sales use the reduced unit cost in column 11 (`F11`) (corrected after verification: the original report mentioned only `F11`). A foreign "return of capital" without a formal capital reduction may be a dividend. | **low** |
| **Fractional shares** | No special rule; XSD quantities allow 8 decimals | high (format) |
| **Short selling** | `PLVPSHORT`: disposals listed first, then covering purchases; the list is filed for the year the covering purchase happens | medium |
| **Shares acquired before 1 Jan 2003** | Historic basis rule (market value at 1 Jan 2006, art. 152). Any such holding is now over 15 years old, so exempt and not reported. | high |
| **Inheritance** | Not a disposal (art. 95(1)); basis as in §4.2; acquisition date = date the decision became final | high |
| **Gift** | A disposal by the donor (art. 94). Deferral possible for gifts to a spouse or child (including an adopted child and a stepchild) if notified by 28 Feb of the following year (art. 100; ZDavP-2 art. 331(2), as amended from 1 Jan 2026). Non-residents have 15 days, and a late notification can be made by self-report under art. 63. The recipient then inherits the donor's date and basis. | high |
| **Accumulating vs distributing ETFs** | No deemed-distribution regime. Accumulating funds are taxed only on disposal; distributions go to Doh-Div type 4. | medium |
| **Domestic mutual funds** | Same capital-gains rules. Switching sub-funds of a SI/EU umbrella fund can be deferred if the manager ensures traceability (art. 100(2)(3)). FIFO may be kept per unit class. | high |
| **RSU / ESPP** | Employment income at vest or exercise (art. 43(4); 65% rule in art. 43(6), for shares of the employer or its parent when employment lasted more than a year, among other conditions). Doh-KDVP basis = market price that day (art. 98(3)); start-up shares under art. 45.b use art. 98(10) and code J. Fringe benefits from a foreign employer are self-assessed separately. See [08](08-brokers-equity-plans.md). | high (law), medium (process) |
| **Payments in lieu of dividends, securities-lending fees, Trading 212 cash interest** | Not addressed by FURS | **low** |
| **Crypto** | Not "capital" under art. 93, so *disposal gains* are untaxed for individuals outside a business activity in 2025/2026. The 25% bill was withdrawn on 12 Nov 2025. Mining income is taxed as "drugi dohodek", and trading as a business is business income (corrected after verification). | medium |

### 9.1 Takeovers and mergers paid in shares

Added on 2026-10-09 for #28, from the primary sources at the end of this section, all read that day. It is not part of the independent verification above.

When a holder's shares are exchanged for shares of another company, as in a foreign company bought by another one for stock, the old shares are **disposed of** and the new ones **acquired**, both on the date of the exchange. Deferral exists only for EU transactions that the companies notify, so a takeover in which a company outside the EU takes part cannot be deferred.

**The exchange is a disposal.**

- Art. 94: *"Za odsvojitev kapitala po tem poglavju se šteje vsaka odsvojitev kapitala ali dela kapitala, kot je zlasti prodaja kapitala, dajanje kapitala v dar, zamenjava kapitala, …"* (every disposal of capital counts, in particular a sale, a gift, an exchange of capital, …).
- Every exchange art. 95 exempts stays with the **same issuer**: same-kind securities that change neither the shareholders' proportions nor the issuer's capital, with no cash (art. 95(5)), and preferred shares for common ones (art. 95(7)). Splits (art. 95(6)) keep the issuer too. A takeover by another company is none of these.
- FURS lists among taxable disposals *"zamenjava kapitala (tudi v primeru združitev in delitev gospodarskih družb)"*, an exchange of capital, including in mergers and divisions (opis). Its deferral paper (§3) adds: *"Pri družbenikih fizičnih osebah, zamenjava deleža praviloma predstavlja obdavčljivo odsvojitev kapitala, skladno s 94. členom ZDoh-2"* (for individual shareholders, an exchange of shares is as a rule a taxable disposal under art. 94).

**Deferral needs an EU transaction that the companies notify.**

- Art. 100(2)(2) allows deferral only for exchanges of shares, mergers and divisions *"kot so opredeljene v zakonu, ki ureja davek od dohodkov pravnih oseb"*, as ZDDPO-2 defines them.
- FURS's deferral paper (§3) traces that provision to art. 8 of Directive 2009/133/EC, on transactions between companies *"iz različnih držav članic"* (from different member states).
- **The company notifies the deferral, for all its shareholders at once.** ZDavP-2 art. 331(5): *"priglasitev za vse zavezance hkrati opravi družba obenem s priglasitvijo po 380. oziroma 381. členu tega zakona"* (the company notifies for all taxpayers at once, together with its own notification under art. 380 or 381). The shareholder files no notification of their own for it; art. 331(1)–(4), the taxpayer's own notification, covers gifts.
- **Sources conflict on who decides.** Art. 331(5) also says the taxpayer *"lahko … uveljavlja odlog"* (may claim the deferral), and the navodila describe a deferred exchange as one the holder did not declare as a disposal, *"(t.j. da je v preteklosti ob zamenjavi deleža po lastni odločitvi odložil ugotavljanje davčne obveznosti)"* (that is, at the exchange they deferred the tax by their own decision). The FURS deferral paper (§3) has the company notify. Read together *(inference)*: the company's notification makes a deferral available, and each holder claims it by not declaring the exchange as a disposal.
- ZDDPO-2's own conditions, read in mirrors *(unverified — see Verification)*:
  - An exchange of shares qualifies only *"če sta prevzemna družba in prevzeta družba rezidenta Slovenije in oziroma ali rezidenta države članice EU, ki ni Slovenija"* (if both companies are resident in Slovenia or another EU state; art. 46(1)(1)).
  - A merger or division is one *"ki se izvede v skladu z določili zakona, ki ureja gospodarske družbe o statusnem preoblikovanju družb"* (carried out under the Slovenian companies act's rules on status changes; art. 48(1)). The shareholder's exemption (art. 49(3)) holds only *"če so izpolnjeni pogoji po 48. do 53. členu tega zakona in na podlagi priglasitve transakcije davčnemu organu"* (art. 53(1)), and those conditions include both companies being resident in Slovenia or another EU state (art. 50(1)). That a merger under foreign law falls outside art. 48(1) as well is an inference.
- ZDavP-2, which is primary, points to those residence tests: the company must hold evidence of residence *"v skladu s 46. členom ZDDPO-2"* for an exchange of shares (art. 380(8)(1)), and that the companies count as EU residents *"po 50. členu ZDDPO-2"* for a merger or division (art. 381(8)(1)).
- A takeover in which a company outside the EU takes part is therefore taxed when it happens. A deferred EU exchange instead carries the old shares' acquisition dates and values over to the new ones (art. 100(5)(2), (6)(2)), and when they are later sold, their list's `ForeignTransfer` box is "DA" (navodila: a security of a foreign company acquired by an exchange under Directive 90/434/EGS, where the exchange was not declared as a disposal).

**Value.**

- **Disposal value** (art. 99(1)): the value in the contract, but *"če vrednost kapitala ob odsvojitvi ni razvidna iz pogodbe, … se za vrednost kapitala ob odsvojitvi šteje primerljiva tržna cena kapitala ob odsvojitvi"* (if the contract shows no value, the comparable market price of the capital at disposal). A merger agreement states an exchange ratio, not a price, so the market price applies.
- **Acquisition value of the new shares** (art. 98(2)): *"vrednost kapitala v času pridobitve, ki jo zavezanec dokazuje z ustreznimi dokazili"* (their value at acquisition, which the taxpayer proves with suitable evidence).
- Each is converted at the Banka Slovenije rate of its own day (arts. 98(9), 99(3)).
- **Cash** paid with the shares, for example for fractions, is part of what the old shares were exchanged for, so it adds to the disposal value. ZDDPO-2 taxes the cash part even of a deferred exchange for its own taxpayers (arts. 45(2), 49(4), read in mirrors); that the same holds for an individual under art. 100 is an inference.
- **Not settled by any FURS text found:** whether "the comparable market price of the capital at disposal" means the old shares' last price before they stopped trading or the market value of the shares received. The two differ by the deal's spread. Several texts favor the shares received, valued on the day the exchange takes effect:
  - ZDDPO-2 measures the consideration at the fair value of the acquirer's securities (arts. 45(2), 49(4), read in mirrors).
  - When a company changes its status, ZDavP-2 art. 332 obliges the new or acquiring company to give its owners the data for their tax, *"vključno s podatki o menjalnem razmerju, denarnem izplačilu in vrednosti novih deležev"* (including the exchange ratio, the cash paid and the value of the new shares).
  - For a deferrable exchange, the company keeps the market value of both companies' securities *"na dan vpisa transakcije v sodni register"* (on the day the transaction is entered in the court register; ZDavP-2 art. 380(8)(2)), and for a merger, that of the acquirer's securities on the merger's accounting day (art. 381(8)(8)).

  None of these is about an individual's taxable exchange, so the question stays open. See Open questions.
- **Recommended for TaxReporter:** the user gives the price of one share received on the exchange date, in its currency, and where that price comes from. The app has no market data and fetches nothing but its rate snapshot. It converts at the Banka Slovenije rate of the day. The new lot's acquisition value is the shares received times that price. The disposal value is the same amount plus any cash received, so the only difference between the two sides is the cash.

**Dates.**

- Disposal (art. 102) and acquisition (art. 101(1)): the date of the contract or other legal transaction, otherwise the date *"razviden iz drugih dokazil"* (shown by other evidence).
- For a merger, that is the day it took legal effect, as the companies announce it *(inference)*. The shareholder is not a party to the merger agreement, and their shares are exchanged when the merger takes effect, so this relies on the "other evidence" clause. Two other readings exist: the day the agreement was signed, which can fall in an earlier tax year, and, for the company that merges away, art. 102's rule for a company that ceases to exist, *"datum sklepa organa o prenehanju"* (the date of the body's resolution on its termination). See Open questions.
- ZDavP-2 dates a deferrable exchange by its entry in the court register: the company notifies by 15 January *"za transakcije, ki so bile v sodni register vpisane do vključno 31. decembra prejšnjega leta"* (for transactions entered in the court register by 31 December of the previous year; art. 380(2)), and both companies report the *"dan izvršitve prevzema"* (the day the takeover was carried out; art. 380(11)). That supports the effective-date reading, though it governs the deferral procedure rather than a taxable exchange.
- For an exchange offer, the holder concludes a contract by accepting it, so the contract's date applies *(inference)*.
- A broker's booking date is none of these: Trading 212 booked one several days after the merger took effect (research 06 §4.3).
- The new shares' holding period starts on that date. A taxable exchange restarts the clock for the rates that fall after 5 and 10 years (art. 132(2)) and for the exemption after 15 (art. 96); both are in §2.1, and the period is counted as in §4.5.

**On Doh-KDVP.**

- The old security's list gets a sale row: F6 the date, F7 the quantity, F9 the value per unit. It is matched FIFO and checked under the 30-day rule like any sale. Whether the shares received count as same-kind replacement capital for a loss on the exchange is part of the open question on same-kind capital (Open questions).
- In the year the new shares are sold, their list includes the purchase row, in date order with any other purchases of that security: F1 the exchange date, F2 **`E`** (*"zamenjava kapitala ob statusnih spremembah družbe"*, an exchange of capital on a company's status change; [01 §6](01-furs-doh-kdvp.md#6-acquisition-method-codes-f2-type-typegaintype)), F3 the shares received, F4 the value per unit.
- `ForeignTransfer` is a box of the whole list ([01 §4.2](01-furs-doh-kdvp.md#42-kdvpitem-one-per-inventory-list-popisni-list)), about how the sold security was acquired. After a taxable exchange it is false on both lists, unless the old shares themselves came from an earlier deferred EU exchange.
- Code `E` names status changes such as mergers and divisions. For an exchange offer without a merger, which ZDDPO-2 art. 44 calls an exchange of shares, the form offers nothing closer than `H` (*drugo*). See Open questions.

**What TaxReporter needs from the user** (#28): the exchange date, the price of a share received and where it comes from, any cash received with the shares, the security and number of shares received when the export has no row for them, and confirmation that no deferral applies (the company notified none, or the holder does not claim it). A deferred EU exchange is outside #28 and stays refused.

**Sources read on 2026-10-09** (Last-Modified as served):

| Source | Last-Modified |
|---|---|
| ZDoh-2 arts. 93–103 and 132, PISRS consolidated text through ZZZRO-1 (UL 22/25), that is NPB 35, in force from 19 Jul 2025 to 4 Mar 2026 ([file](https://pisrs.si/api/datoteke/integracije/358559624)); NPB 36 adds the INR rules (§2.3), which this section did not re-read | not sent (HTML) |
| ZDavP-2 arts. 331, 332, 380 and 381, PISRS consolidated text NPB 32, through ZDavP-2P (UL 100/25) ([file](https://pisrs.si/api/datoteke/integracije/594731150)) | not sent (HTML) |
| [FURS opis, 15th edition](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Obresti_dividende_in_dobicek_iz_kapitala.doc) | 4 Aug 2026 |
| [FURS, Odlog ugotavljanja davčne obveznosti](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Odlog_ugotavljanja_davcne_obveznosti.doc), §3 | 27 Mar 2026 |
| [eDavki, Navodilo Doh-KDVP (2025 form)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf); the 2026 edition is not published yet (`doh_odm_kdvp_26.n.sl.pdf` returns 404) | 14 Jan 2026 |
| ZDDPO-2 arts. 44–46, 48–50 and 53 in two mirrors: NPB 14 at [zakonodaja.com](https://zakonodaja.com/zakon/zddpo-2/46-clen-pogoji), and the text in force from 21 Nov 2025 at [racunovodstvo.net](https://www.racunovodstvo.net/zakonodaja/zddpo/53-clen). Every paragraph cited here reads the same in both (compared on 2026-10-09; art. 48(2)–(4), not cited, differ). **Unverified:** PISRS's own file of the current text, NPB 23 ([ZAKO4687](https://pisrs.si/pregledPredpisa?id=ZAKO4687)), was not read | not sent (mirrors) |

---

## 10. Deadlines, filing and corrections

### 10.1 Deadlines

Doh-KDVP, Doh-Div, Doh-Obr, the deposit-interest return and Doh-IFI are all due by **28 February** of the following year (ZDavP-2 art. 326(1); for Doh-IFI, ZDDOIFI art. 15(3)). If the last day falls on a Sunday, a holiday or another day the authority does not work, the deadline moves to the next working day under **ZDavP-2 art. 45(2)** ("materialni roki") (corrected after verification). The original report cited "ZUP art. 101(4), applied through ZDavP-2 art. 2(3)"; ZUP art. 101 has only two paragraphs, and 101(2) is merely the analogous procedural rule. The dates below are unchanged by the correction.

| Tax year | Statutory deadline | Effective deadline |
|---|---|---|
| 2024 | 28 Feb 2025 | 28 Feb 2025 |
| 2025 | 28 Feb 2026 (Saturday) | **Monday 2 Mar 2026** (FURS public call) |
| 2026 | 28 Feb 2027 (Sunday) | **Monday 1 Mar 2027** (computed; 1 Mar 2027 is not a Slovenian holiday; confirm against the FURS public call in January 2027) |

### 10.2 Filing rules

- **Doh-KDVP must be filed electronically** if there were more than 10 transactions (acquisitions in earlier years plus taxable disposals in the year; art. 326(7)). The same 10-transaction rule also covers Doh-IFI.
- **Doh-Div and Doh-Obr must be filed electronically** if there were more than 5 payments (art. 326(8), added by ZDavP-2P and in force from 1 Jan 2026 with no transitional rule). The FURS public call for tax year 2025 already applied it to the 2025 returns filed in 2026 (corrected after verification).
- Filing "not in the prescribed manner", for example on paper when e-filing is mandatory, is fined EUR 250–400 under ZDavP-2 art. 394(1) (corrected after verification).
- Doh-KDVP must be filed **even if only losses** were realized (FURS Q14: "ne glede na to ali s trgovanjem realizira dobiček ali izgubo").
- Only lots disposed of within 15 years of acquisition are listed.

### 10.3 Assessment and payment

- FURS issues the assessment by **30 April** (art. 330(2)).
- Tax is due **30 days after service** of the decision (art. 66). Payment goes to SI56 0110 0888 1000 030 with reference SI19 *[tax number]*-41009.

### 10.4 Late filing and corrections

| Return status | When | Legal basis |
|---|---|---|
| 1 – filing after the deadline | With an excuse, within 8 days after the excuse ends and at most 3 months after the deadline | ZDavP-2 art. 62 |
| 2 – self-report (*samoprijava*) | Until the decision is served or an inspection, misdemeanor or criminal procedure starts. Interest of **3% a year** is charged; no fine if the tax is paid. If the tax assessed on the self-report is not paid on time, the return is treated as filed late and the fine exemption is lost (art. 63(3)) (corrected after verification). | arts. 63, 396 |
| 3 – correction | Until the decision is served | art. 64 |

### 10.5 Fines

The amounts are **current** (corrected after verification; the original report rated them medium confidence because its source was a consolidated text last revised 31 Dec 2020). ZDavP-2 NPB 32 (from 2 Jul 2026, including ZDavP-2O and ZDavP-2P) keeps:

- EUR 250–400 for failing to file on time, or not in the prescribed manner (art. 394);
- EUR 400–5,000 for false or incomplete data (art. 395);
- EUR 2,500–15,000 in particularly serious cases, where unpaid tax exceeds EUR 5,000 (art. 398).

ZDDOIFI-B added matching fines for Doh-IFI (arts. 25.a–25.d).

---

## 11. Implementation checklist

1. Build one FIFO queue per taxpayer per security, merged across all brokers. Keep separate queues only for `PLVPGB`.
2. Use trade dates. Convert every leg at the BSI rate for its own date. Exclude separately charged commissions from prices.
3. Route instruments to the right form using the table in §3. Never put ETCs or ETNs on Doh-KDVP.
4. Run a wash-sale engine reproducing the FURS examples, including the rule that the unsold remainder of the lot being sold is never replacement (examples 2, 3, 7). Ask the user about the family-member and 25%-entity triggers, and decide with them how to date-bound those triggers.
5. In previews, apply normed costs with the cap, offset losses within the year, and allocate across holding-period buckets per art. 97(4). Show that FURS computes the final tax.
6. Doh-Div: gross amount, actual foreign tax, `SourceCountry` from the ISIN, type 4 for funds. Warn when withholding exceeds the treaty rate (credit capped; reclaim abroad).
7. Warn that e-filing is mandatory above the thresholds, and show the shifted deadline (1 Mar 2027).
8. Support a per-lot acquisition-value override for lots whose basis was stepped up by a foreign exit tax (FURS Q13) (corrected after verification).

## Verification

An independent verifier re-checked all 25 critical claims against the PISRS consolidated texts (ZDoh-2 NPB 34–36, ZDavP-2 NPB 32), the FURS opis (15th edition), the FURS wash-sale explanation and its examples, the FURS IFI brochure, the eDavki instructions and XSD, the FURS public calls, ZDDOIFI-B, ZDavP-2P, ZINR and the US treaty text. All 25 were confirmed; three needed minor corrections, applied inline.

**Added after verification (2026-10-09):** §9.1, on takeovers and mergers paid in shares, was written later from the primary sources it lists and has not been independently verified. The same day, the §9 row on mergers was reworded to point to it, and this unverified update raised its "disposal" confidence from medium to high; its valuation and date parts are §9.1's. §9.1's reading of ZDDPO-2 arts. 44–46, 48–50 and 53 is marked unverified: it comes from two mirrors, of NPB 14 and of the text in force from 21 Nov 2025, which read the same in every cited paragraph, while PISRS's own file of NPB 23 was not read. The section's conclusion rests mainly on primary texts: ZDoh-2 art. 94, ZDavP-2 arts. 331(5), 380(8)(1) and 381(8)(1), and the FURS opis and deferral paper.

**Claims not confirmed:** none.

**Confirmed claims with minor corrections:**

| Claim | Verdict | Correction | Evidence |
|---|---|---|---|
| US–Slovenia treaty Article 10 limits US withholding on portfolio dividends to 15% (5% if the holder owns at least 25% of voting stock); a resident gets a 15% credit and pays 10% in Slovenia even if 30% was withheld (§7.3). | confirmed, minor correction | The 5% rate (art. 10(2)(a)) applies only if the beneficial owner is a **company** that directly owns at least 25% of the voting stock. An individual is always capped at 15% (art. 10(2)(b)); RIC/REIT dividends have their own limits (art. 10(3)). | [IRS treaty text](https://www.irs.gov/pub/irs-trty/slovenia.pdf) |
| Returns are due by 28 February, moved to the next working day when that day is a non-working day; 2 March 2026 for TY2025 and 1 March 2027 for TY2026 (§10.1). | confirmed, minor correction (citation only) | The next-working-day rule is ZDavP-2 art. 45(2) ("materialni roki"), not "ZUP art. 101(4) via ZDavP-2 art. 2(3)"; ZUP art. 101 has only two paragraphs. The dates are unchanged. | [FURS public call 2026](https://www.gov.si/assets/organi-v-sestavi/FURS/Novice-2026/Javni-poziv-rok-je-2.3.2026.pdf) |
| The foreign tax credit cannot exceed the lower of final foreign tax actually paid or Slovenian tax; with a treaty, foreign tax is credited only up to the treaty rate and any excess cannot be carried to other periods (art. 137(1)–(3)) (§7.2). | confirmed, minor correction | Art. 137(3) only bars carrying to other periods the part of foreign tax that exceeds the Slovenian tax. Tax withheld above the treaty rate is not "final foreign tax" under 137(2) at all, so it is never creditable and can only be reclaimed from the source state. | [PISRS ZDoh-2](https://pisrs.si/api/datoteke/integracije/358559624) |

**Missed items** (facts the verifier found that the report lacked or got wrong; each is applied inline where noted):

- **Deadline rule citation:** use ZDavP-2 art. 45(2) for the next-working-day shift (checked in ZUP NPB 13 and 14 after ZUP-I, UL 85/2025). Dates unchanged: 2 Mar 2026 and 1 Mar 2027. Applied in §10.1.
- **Exit-tax basis on immigration:** FURS Q13 keeps the original acquisition date, but where Germany charged exit tax the acquisition value is the FMV used for that exit tax (SI–DE treaty art. 13(5)), plus unclaimed art. 98(7) costs. Provide a per-lot basis override. Applied in §4.3 and §11.
- **Code K:** `Doh_KDVP_9.xsd` (Last-Modified 6 Aug 2026) has code K for transfers of securities or fund units from an INR to a trading account; the 2025 paper form lists only A–J. Lots leaving an INR from 5 Mar 2026 need code K, the transfer date (art. 101(7)) and the INR-computation value (art. 98(11)). Applied in §1 and §2.3.
- **Dormant or closed INR:** income on INR assets earned while the INR is dormant (*mirovanje*) or after it is closed is ordinary capital income on Doh-Div, Doh-KDVP and Doh-Obr (FURS opis 5.3). Applied in §2.3 and §3.
- **Revolut's two savings products:** Instant Access Savings (Revolut Bank UAB) is deposit interest in the EUR 1,000 pool (Q19); the Savings Flexible Account is a money-market fund whose interest goes on Doh-Obr at 25% with no allowance, and whose fund-unit purchases, reinvestments and redemptions all go on Doh-KDVP, even at zero gain (Q18/Q18a). Applied in §3 and §8.
- **Derivative details:** CFD financing income and dividend adjustments are interest (Doh-Obr); leveraged trading uses 0.25% + 0.25% normed costs (ZDDOIFI art. 11(1)); crypto-settled futures are not derivatives under ZTFI-1; the 40%/27.5%/20/15/10/exempt-after-20 scale applied only from 2020 to 2025 (ZDDOIFI-A). Applied in §2.4 and §3.
- **US treaty rates:** 5% only for a company owner with at least 25% of the voting stock; individuals always 15%; RIC dividends always 15%; REIT dividends 15% only within art. 10(3) limits. Applied in §7.3.
- **Art. 137(3) attribution:** 137(3) concerns foreign tax above the Slovenian tax; tax above the treaty rate is never creditable under 137(2). Enter the tax actually paid; FURS applies the cap. Applied in §7.2.
- **Fines are current** under ZDavP-2 NPB 32 (from 2 Jul 2026): art. 394 EUR 250–400 (also for filing not in the prescribed manner, e.g. on paper when e-filing is mandatory), art. 395 EUR 400–5,000, art. 398 EUR 2,500–15,000. An unpaid self-report counts as a late return (art. 63(3)). ZDDOIFI-B added matching Doh-IFI fines (arts. 25.a–25.d). Applied in §10.2, §10.4 and §10.5.
- **BSI-published is not always ECB:** BSI publishes a monthly table for currencies without an ECB rate, and there is still no FURS weekend/holiday rule. The verifier's RUB example was wrong: the full BSI monthly history has no RUB entries (checked 2026-10-07), and BSI points to InforEuro. Applied in §6.
- **Wash-sale engine:** FURS examples 2, 3 and 7 show the unsold remainder of the lot being sold is never replacement capital ("same-lot remainder excluded", not "same-day acquisitions excluded"); the related-party trigger has no statutory 30-day window, so its time bound is a design decision. Applied in §5.3 and §11.
- **Crypto is not wholly tax-free:** only disposal gains outside a business are untaxed; mining income is "drugi dohodek" (25% advance tax, part of the annual base; fu.gov.si life event "Rudarim virtualne valute"), and business trading is business income. Applied in §1, §3 and §9.
- **Doh-KDVP foreign tax and PLVPZOK:** Doh-KDVP can carry foreign tax paid on a capital gain (`HasForeignTax`/`ForeignTax`, "Davek, plačan v tujini DA/NE"; ZDavP-2 art. 328(1) covers all capital income), and share-capital reductions with unchanged quantity go on the separate `PLVPZOK` list. Applied in §3 and §9.
- **Doh-Div required fields and instructions file:** payer name, address and country are mandatory and separate from the source country; `ForeignTax` is mandatory for non-SI payers; eDavki now links `doh_odm_div20.n.sl.pdf` (modified 30 Mar 2026) for 2020, 2021 and 2023+, with the same wording as the `doh_odm_div.n.sl.pdf` cited here. Applied in the intro and §7.1.
- **Transaction-account interest:** art. 82(2) exempts interest on a positive transaction-account balance at a payment service provider up to its sight-deposit rate; Trade Republic accounts of Slovenian residents do not qualify (Q22). Test other EU banks' current-account interest the same way. Applied in §8.

**Qualifications on confirmed claims** (verifier notes that refine a confirmed claim):

- *Rates (§2.1):* ZDoh-2 NPB 34, 35 and 36 have identical art. 132(1)–(2); the PISRS amendment list ends with 104/24 (ZDoh-2AB), 22/25 (ZZZRO-1) and 40/25 (ZINR), and no 2025–2026 act changes capital-gains rates. A FURS note on ZDoh-2Z confirms the 2022 change; ZDoh-2 art. 2 applies the law in force on 1 January of the tax year.
- *Dividends (§2.2):* from 5 Mar 2026, dividends earned inside an INR are taxed as INR income instead (art. 90(5)); dividends must be declared even if reinvested (FURS public call 2026).
- *Normed costs (§4.1):* art. 98(7) lists the only add-on costs. FURS Q18a leaves a EUR 12 fee out of the gain computation.
- *FIFO (§4.4):* no FURS text says "across brokers" in so many words, but the statute leaves no other basis for separate queues; both exceptions are optional.
- *Losses (§5.1, §5.2):* the carried loss is claimed via `TaxBaseDecrease` (form section 5); ZDoh-2 and Doh-IFI losses never offset each other (ZDDOIFI art. 11(4)).
- *Wash-sale (§5.3):* the 30-day window is only in point 1 of art. 97(5); the FURS explanation is the 1st edition of January 2015.
- *FX (§6):* the current Doh-Div instructions and XML guide convert both the dividend and the foreign tax at the BSI rate valid on the dividend date.
- *Trade date (§4.3):* no FURS text uses the settlement date; special dates exist for bonus shares, INR transfers and inheritance.
- *Deadlines (§10.1):* the same deadline covers Doh-KDVP, Doh-Div, Doh-Obr, the deposit-interest return and Doh-IFI (ZDDOIFI art. 15(3)); 1 Mar 2027 is not a Slovenian holiday.
- *E-filing (§10.2):* ZDavP-2P art. 64 sets entry into force on 1 Jan 2026 with no transitional rule; the 2025 public call applied both thresholds to 2025 returns.
- *Foreign brokers (§3):* ZDavP-2 art. 339(1) also lists notaries and the companies concerned as reporters; FURS opis 3.3 says dividends are not part of the annual return, except optionally for 2022.
- *Interest (§8):* FURS Q&A 6.2 Q24 names eToro, Mintos, Interactive Brokers Central Europe Zrt. and Interactive Brokers Ireland Ltd.
- *ZDDOIFI-B (§2.4):* in force 15 days after publication; its art. 5 applies the changes to tax years from 1 Jan 2026; art. 14's 27.5% became 25%, 14(2)–(3) and art. 10 (the 20-year exemption) were deleted.
- *INR (§2.3):* ZINR art. 45 sets entry into force the day after publication and application nine months later (5 Mar 2026); ZDoh-2 NPB 36 starts on that date.
- *15-year listing (§5.4):* whether a sale on the exact anniversary counts as "after 15 years" remains unverified.
- *Dividend codes (§7.1):* the codes are identical in `doh_odm_div20.n.sl.pdf` and the XML guide; the 2022 form set is different.
- *Gifts (§9):* ZDavP-2P amended art. 331(2) from 1 Jan 2026; the notification deadline for securities is the art. 326(1) deadline.
- *Self-report (§10.4):* ZDavP-2 NPB 32 is in force from 2 Jul 2026.
- *Crypto (§9):* the withdrawal is documented in secondary sources (24ur, zanima.me, RTV, poslovni.si); no National Assembly primary record was retrieved, and the August 2026 FURS opis has no crypto-gains section.

## Open questions

- Lots bought on the same day: is the time of acquisition the order Art. 103(1) means, and what applies when an export gives no time (§4.4)? No FURS example covers it.
- Which BSI rate to use when no reference rate is published that day (weekends, TARGET holidays)? BSI says rates have no prescribed validity period, and no FURS primary text was found. Prior art (ib-edavki) uses the last earlier published rate. This should be cross-checked with the BSI research note and ideally with a FURS written answer. ([03 §9](03-bsi-exchange-rates.md#9-weekends-holidays-and-target-closing-days): BSI's own lookup returns the last list on or before the day; verified as website behavior, not law.)
- Boundary-day counting for "po dopolnjenih 5/10 letih" and "po 15 letih imetništva": does a sale on the exact anniversary date already get the lower rate or exemption? eDavki computes the tax, so test with real filings.
- XML semantics of Doh-KDVP `Sale/F10`: settled from primary sources as `true` = the loss may reduce the base ([01 §5.2](01-furs-doh-kdvp.md#52-securities-plvp-securitieswithcontract-is-the-same-plus-stockexchangename-max-30-after-isfond)); an eDavki import test in January 2027 is still to confirm it. Prior-art tools disagree.
- Wash-sale edge case: are acquisitions on the same day as the lot being sold excluded from replacement capital (inferred from FURS example 17)? (The verifier reads examples 2, 3 and 7 as excluding the unsold remainder of the same lot; §5.3.)
- Which lots carry the disallowed part of a partly replaced loss? The Doh-KDVP builder (`packages/furs/src/build-kdvp.ts`) writes each sale as runs of rows in the order its lots are matched, and takes the disallowed part from the sale's first lots sold at a loss. FURS's examples measure replacement by quantity and say nothing about lots whose losses differ. Confirm with FURS, or with an eDavki import once the 2026 form opens in January 2027.
- A sale whose lots mix a gain and a loss: since eDavki takes gains and losses lot by lot (§4.1, §4.6), the builder writes the gain lots as rows without F10 and the loss lots as rows with the 30-day rule's verdict, and the rule counts only the shares sold at a loss ("the rule applies only to losses", above). A pre-PR review found that counting the whole sale let gain shares use up replacements and let a disallowed row land on gain lots, both understating tax; those are fixed. Confirm the row layout with the same eDavki import.
- Treaty dividend rates beyond the US. The dividend estimate caps a credit at a treaty rate only where this research has the treaty text, so far the US (15%, §7.3). The usual sources of dividends for Slovenian investors (Germany, the Netherlands, France, Switzerland, Austria and others) need their treaty articles cited before `treatyDividendRate` in `packages/core/src/dividends.ts` carries them. Until then the app warns and caps the credit at the Slovenian tax only; the return itself carries the tax actually withheld either way, and eDavki applies the caps.
- Treatment of cash paid instead of a fraction of a spin-off share: a dividend (art. 90) or a partial disposal of the old shares (art. 94)? It is counted as a dividend for now, with a warning (§9).
- Treatment of foreign spin-offs, scrip and stock dividends, US "return of capital" distributions, and foreign tender offers (organized market or not, which decides between dividend code 7 and capital gain).
- Treatment of rights handed out free to holders, such as subscription rights. Is that a distribution taxed as a dividend (art. 90), an acquisition at a cost of 0, or a derivative under ZDDOIFI? Trading 212 books them as `Custom stock distribution` at a price of 0 ([06 §4.3](06-brokers-ibkr-t212-revolut.md#43-action-values-h-unless-noted)). The reader refuses them until this is settled.
- Which market price values a taxable exchange of shares (art. 99(1)): the old shares' last price before they stopped trading, or the shares received at the exchange? No FURS text answers it for an individual's taxable exchange. §9.1 recommends the shares received, which ZDDPO-2 arts. 45(2) and 49(4) and ZDavP-2 arts. 332, 380(8)(2) and 381(8)(8) all point toward.
- The Doh-KDVP code for shares received in an exchange offer without a merger (ZDDPO-2 art. 44): `E` names status changes, such as mergers and divisions, so is it `H` (*drugo*)? (§9.1)
- The date of a merger's exchange of shares: the day the merger took legal effect, which §9.1 infers from the "other evidence" clause of arts. 101(1) and 102, the day the merger agreement was signed, or, for the company that merges away, the date of the resolution on its termination (art. 102)? It decides the tax year, the holding period and the exchange rate. ZDavP-2 art. 380(2) dates a deferrable exchange by its entry in the court register, which supports the first. Related: #13, the source for the trade-date rule.
- Treatment of payments in lieu of dividends, IBKR stock-lending (SYEP) income, and Trading 212 cash interest (deposit interest with the EUR 1,000 allowance versus other interest).
- Does FURS compute the foreign tax credit per Doh-Div row or aggregated per country or year? Should `ForeignTax` be entered as the full amount withheld (30%) or capped at the treaty rate? The instructions say to enter the tax paid. (Per the verifier, enter the tax actually paid and FURS applies the cap; the per-row versus aggregate question remains open.)
- Identity key for "istovrstni kapital" in FIFO and wash-sale matching: is ISIN sufficient, and how should ISIN changes after corporate actions be linked?
- Are the ZDavP-2 fine amounts (arts. 394, 395, 398) as shown in the 2020 consolidated text still current after ZDavP-2O and ZDavP-2P? (Answered: yes, per ZDavP-2 NPB 32; §10.5.)
- Status of crypto taxation and any capital-income changes for tax year 2027 after the 2026 parliamentary elections.
- Are warrants and other structured products treated as IFI (Doh-IFI) or as securities (Doh-KDVP)? The FURS IFI brochure explicitly covers certificates, ETCs and ETNs but warrants were not verified.

Also raised during verification:

- How should the related-party wash-sale trigger (art. 97(5) point 2), which has no statutory 30-day window, be time-bounded in the engine?

## Sources

- [FURS - Obresti, dividende, dobiček iz kapitala in dohodek z INR, podrobnejši opis (15. izdaja, avgust 2026)](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Obresti_dividende_in_dobicek_iz_kapitala.doc)
- [FURS - Dobiček iz kapitala: pravilo navidezne odsvojitve kapitala (wash-sale rule)](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Dobicek_iz_kapitala_-_pravilo_navidezne_odsvojitve_kapitala.docx)
- [FURS - Odlog ugotavljanja davčne obveznosti](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Odlog_ugotavljanja_davcne_obveznosti.doc)
- [FURS - Davek od dobička od odsvojitve izvedenih finančnih instrumentov, brošura (julij 2026)](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Davek_od_dobicka_od_odsvojitve_izvedenih_financnih_instrumentov/Opis/Obdavcitev_dobicka_od_odsvojitve_izvedenih_financnih_instrumentov.docx)
- [eDavki - Navodilo Doh-KDVP (2025 form)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf)
- [eDavki - Obrazec Doh-KDVP (2025)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.i.sl.pdf)
- [eDavki - Navodilo za izpolnjevanje napovedi za odmero dohodnine od dividend (March 2026)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div.n.sl.pdf)
- [eDavki - Doh-Div XML navodilo](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_xml.n.sl.pdf)
- [eDavki - Doh_KDVP_9.xsd](https://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd)
- [eDavki help - Uvoz popisnih listov vrednostnih papirjev](https://edavki.durs.si/EdavkiPortal/PersonalPortal/%5B360253%5D/Pages/Help/sl/Documents_Doh_KDVP_PopisniListi.htm)
- [FURS - Javni poziv za leto 2025 (rok 2. 3. 2026)](https://www.gov.si/assets/organi-v-sestavi/FURS/Novice-2026/Javni-poziv-rok-je-2.3.2026.pdf)
- [FURS - Javni poziv za leto 2024 (rok 28. 2. 2025)](https://www.gov.si/assets/organi-v-sestavi/FURS/Novice-2025/Javni-poziv-rok-je-28.-2.-2025.pdf)
- [FURS (EN) - Disposal of securities, other holdings or investment coupons](https://www.fu.gov.si/en/life_events_individuals/disposal_of_securities_other_holdings_or_investment_coupons/)
- [FURS - Prejel sem dividende](https://www.fu.gov.si/zivljenjski_dogodki_prebivalci/prejel_sem_dividende/)
- [FURS - Odsvojil sem izvedene finančne instrumente](https://www.fu.gov.si/zivljenjski_dogodki_prebivalci/odsvojil_sem_izvedene_financne_instrumente/)
- [PISRS - Zakon o dohodnini (ZDoh-2)](https://pisrs.si/pregledPredpisa?id=ZAKO4697)
- [PISRS - Zakon o davčnem postopku (ZDavP-2)](https://pisrs.si/pregledPredpisa?id=ZAKO4703)
- [PISRS - Zakon o davku od dohodkov pravnih oseb (ZDDPO-2)](https://pisrs.si/pregledPredpisa?id=ZAKO4687) (canonical page; its consolidated-text file was not read for §9.1)
- [ZDDPO-2 NPB 14, art. 46 (conditions for an exchange of shares), zakonodaja.com mirror](https://zakonodaja.com/zakon/zddpo-2/46-clen-pogoji)
- [ZDDPO-2 NPB 14, art. 50 (conditions for mergers and divisions), zakonodaja.com mirror](https://zakonodaja.com/zakon/zddpo-2/50-clen-pogoji)
- [ZDDPO-2 in force from 21 Nov 2025, art. 53 (the shareholder's rights depend on arts. 48–53 and notification), racunovodstvo.net mirror](https://www.racunovodstvo.net/zakonodaja/zddpo/53-clen)
- [ZDoh-2 consolidated articles (racunovodstvo.net), e.g. art. 97](https://www.racunovodstvo.net/zakonodaja/zdoh/97-clen)
- [ZDoh-2 art. 16 (FX conversion general rule, family member definition)](https://www.racunovodstvo.net/zakonodaja/zdoh/16-clen)
- [ZDavP-2 consolidated articles (racunovodstvo.net), e.g. art. 326](https://www.racunovodstvo.net/zakonodaja/zdavp/326-clen)
- [ZUP art. 101 (deadline on non-working day; cited by the original report, superseded by ZDavP-2 art. 45(2), see §10.1)](https://www.racunovodstvo.net/zakonodaja/zup/101-clen)
- [Uradni list RS 40/2025 - Zakon o individualnih naložbenih računih (ZINR)](https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/2025-01-1572)
- [PISRS - ZINR](https://pisrs.si/pregledPredpisa?id=ZAKO9154)
- [Uradni list RS 104/2024 - ZDoh-2AB](https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/2024-01-3309)
- [Racunovodja.com - Informacija o novostih ZDoh-2AB](https://www.racunovodja.com/clanki.asp?clanek=13581)
- [Racunovodstvo.net - ZDDOIFI-B text](https://www.racunovodstvo.net/zakonodaja/predpis/14381/zakon-o-spremembah-in-dopolnitvah-zakona-o-davku-od-dobicka-od-odsvojitve-izvedenih-financnih-instrumentov-zddoifi-b)
- [Uradni list RS 100/2025 - ZDavP-2P](https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/2025-01-3396/zakon-o-spremembah-in-dopolnitvah-zakona-o-davcnem-postopku-zdavp-2p)
- [Racunovodstvo.net - ZDoh-2 amendment timeline](https://www.racunovodstvo.net/zakonodaja/casovnica/303/zakon-o-dohodnini-zdoh-1-in-zdoh-2)
- [Banka Slovenije - Devizni tečaji (ECB reference rates)](https://www.bsi.si/sl/statistika/devizni-tecaji)
- [US Senate Treaty Doc. 106-9 - US-Slovenia income tax convention](https://www.congress.gov/106/cdoc/tdoc9/CDOC-106tdoc9.pdf)
- [IRS - Slovenia Treasury technical explanation](https://www.irs.gov/businesses/international-businesses/slovenia-treasury-explanation)
- [OZS - Napovedi oddajte do 2. marca 2026](https://www.ozs.si/novice/obresti-dobicek-iz-kapitala-dividende-najemnine-ifi-napovedi-oddajte-do-2-marca-2026-698f0bd72bafbe6b09532c43)
- [Racunovodja.com - Napoved za odmero dohodnine od obresti in dividend (13 Feb 2026)](https://www.racunovodja.com/Clanek/14161)
- [24ur - Kriptodavka (še) ne bo (12 Nov 2025)](https://www.24ur.com/novice/slovenija/kriptodavka-se-ne-bo-svoboda-prosila-za-umik-obravnave-zakona.html)
- [Skupnost občin - Predlog zakona o spremembah ZDoh-2 (22 Sep 2026)](https://skupnostobcin.si/2026/09/22/predlog-zakona-o-spremembah-zakona-o-dohodnini-zdoh-2/)
- [GitHub jamsix/ib-edavki (prior art: trade-date, tradePrice, FX fallback)](https://github.com/jamsix/ib-edavki)

Also cited during verification:

- [PISRS - ZDoh-2 consolidated text file (NPB 34–36)](https://pisrs.si/api/datoteke/integracije/358559624)
- [PISRS - ZDavP-2 consolidated text file (NPB 32)](https://pisrs.si/api/datoteke/integracije/594731150)
- [IRS - US-Slovenia income tax treaty text](https://www.irs.gov/pub/irs-trty/slovenia.pdf)
- [Uradni list RS 85/2025 - ZDDOIFI-B](https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/2025-01-3041/zakon-o-spremembah-in-dopolnitvah-zakona-o-davku-od-dobicka-od-odsvojitve-izvedenih-financnih-instrumentov-zddoifi-b)
- [eDavki - Navodilo Doh-Div (2020, 2021, 2023+)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div20.n.sl.pdf)
- [zanima.me - Kriptovalute v letu 2026 še ne bodo obdavčene](https://www.zanima.me/kriptovalute-v-letu-2026-se-ne-bodo-obdavcene/)
