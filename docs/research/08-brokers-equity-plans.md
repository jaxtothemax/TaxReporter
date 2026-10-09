# Employee equity plan platforms: exports, and how to report RSU/ESPP shares on Doh-KDVP and Doh-Div

> Researched: 2026-10-06 · Verification: not independently verified · Updated: 2026-10-09 (§2.7: an exchange of shares now points to 04 §9.1)
>
> Research for building TaxReporter. It is not tax advice, and FURS publications and the law win over anything written here. Where this page overlaps a verified doc (01–03), the verified doc wins; such places are cross-referenced inline. See the [README](README.md#confidence-and-verification-legend) for the legend.

**Scope.** This page covers the platforms that Slovenian tech employees use to receive foreign employer shares: Charles Schwab Equity Awards, E\*TRADE / Morgan Stanley at Work, legacy Morgan Stanley StockPlan Connect, Shareworks, Fidelity Stock Plan Services, Computershare (Employee Online and EquatePlus, formerly Equatex/UBS) and Carta. For each one it covers:

1. what a participant can export, with exact headers and JSON keys,
2. how vests, sell-to-cover, ESPP purchases, sales, dividends and withholding show up in that export,
3. how the data maps to Doh-KDVP and Doh-Div.

Payroll taxation at vest or purchase (REK-O, boniteta) is out of scope. It only appears where it fixes the cost basis or the acquisition date.

The research produced synthetic samples that copy the real headers. Every value in them is fictional, including the ticker ACME, the ISIN and the FX rates. They are not committed with this page; once validated against real anonymized exports (see Confidence), they should become test fixtures.

---

## 1. Slovenian rules that decide cost basis and acquisition date

### 1.1 Statutory basis

| Topic | Rule | Source |
|---|---|---|
| Cost basis of shares from an employer (RSU, ESPP, exercised options) | "Kadar zavezanec pridobi delnice ali drug kapital na način, določen v četrtem odstavku 43. člena …, se za nabavno vrednost … šteje **primerljiva tržna cena delnice … na dan, ko je bila pravica izvršena oziroma na dan, ko je zavezanec pridobil delnice**". The basis is FMV on the acquisition day, not the discounted price paid. | ZDoh-2 Art. 98(3); KDVP instructions 2025, column 4 ("comparable market price of the share on the date of acquisition") |
| When the employment benefit is measured | On the day the right is exercised or the shares are acquired (43(4)). For shares granted by a foreign group company, FURS states the obligation arises "ko so delnice dane na razpolago delavcu" (when the shares are made available to the worker), and the share value is fixed at that moment. | ZDoh-2 Art. 43(4); FURS *Bonitete* (13th ed., July 2026), §3.3.3 |
| 65% benefit relief (since 2022) | It reduces only the employment-income base. It does **not** reduce the KDVP basis, which stays at 100% FMV under 98(3). FURS: the relief "se ne uporablja, kadar gre za neposredno podelitev nagrade v obliki delnic". | ZDoh-2 Art. 43(6)–(8); FURS *Bonitete* §3.3.1 |
| Start-up employee regime (new from TY 2025) | Basis is the value of the share (the benefit) on the day it was received, less any negative difference under 45.b(3). Acquisition code **J**. Applies only to shares in a Slovenian employer listed in the register of innovative start-ups. | ZDoh-2 Art. 45.b, Art. 98(10) (ZDoh-2AB, UL 104/24); form legend J |
| FX | The acquisition value is converted at the **Banka Slovenije** rate valid on the acquisition date. The disposal value uses the rate on the disposal date. | ZDoh-2 Art. 98(9), 99(3) |
| Acquisition time | The date of the contract or legal transaction. "V drugih primerih … datum, ki je razviden iz drugih dokazil." | Art. 101(1) |
| Disposal time | The date of the contract, which means the **trade date**, not settlement. | Art. 102 |
| Stock method | FIFO across all same-type holdings (Art. 103(1)). The lot the broker says it sold does not matter. | Art. 103 |
| Rates | 25%. 20% after 5 years held, 15% after 10 years, exempt after 15 years. Holding starts at vest or purchase, **not at grant**. | Art. 132(1)–(2), Art. 96(1); FURS capital-income guide (15th ed., Aug 2026) |
| Normalized costs | On a gain, the base is reduced by min(1% of acquisition value + 1% of disposal value, gain). Actual fees are not deducted. | Art. 97(1) |
| 30-day loss rule | A loss is not deductible if "vsebinsko istovrstni nadomestni kapital" is acquired within 30 days before or after the sale. **An RSU vest or ESPP purchase of the same ticker counts as an acquisition.** | Art. 97(5); KDVP instructions, column 10 |

The FX, acquisition-time, disposal-time, FIFO, rate, normalized-cost and 30-day rows agree with the verified Doh-KDVP research ([01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing)), which also notes that the 30-day window crosses the year end, and with the verified tax-rules research ([04](04-si-tax-rules.md)), which also confirms the employee-share basis rule of art. 98(3) ([04 §4.2](04-si-tax-rules.md#42-acquisition-value-disposal-value-fees)). Per [04 §5.3](04-si-tax-rules.md#53-wash-sale-rule-pravilo-navidezne-odsvojitve-art-975), the unsold remainder of the lot being sold is never replacement capital, which matters when part of one vest is sold to cover tax.

Two consequences follow:

- The ESPP discount and the RSU value at vest are employment income, taxed through payroll.
- The capital gain is measured from FMV at vest or purchase.

The issuer's own Slovenian country supplement (Renault 2024) says the same: the gain is "vrednostjo delnic, ko so vam izročene" (measured from the value of the shares when they were handed over to you), and the rates are 25/20/15/0.

### 1.2 Which `F2` (Način pridobitve) code?

The `typeGainType` enumeration in `Doh_KDVP_9.xsd`:

| Code | Meaning |
|---|---|
| A | vložek kapitala (capital contribution) |
| B | nakup (purchase) |
| C | povečanje kapitala z lastnimi sredstvi zavezanca (capital increase from the taxpayer's own funds) |
| D | povečanje kapitala iz sredstev družbe (capital increase from company funds; basis = 0) |
| E | zamenjava kapitala ob statusnih spremembah (exchange in a corporate reorganization) |
| F | dedovanje (inheritance) |
| G | darilo (gift) |
| H | drugo (other) |
| I | pripis dobička / prenos IK iz INR (profit allocation / fund units from an INR account) |
| J | inovativna zagonska podjetja, 45.b (innovative start-ups) |
| K | prenos VP iz INR (securities transferred from an INR account) |

The XSD still exposes `Doh_KDVP_9` (Last-Modified 2026-08-06). `Doh_KDVP_10.xsd` returns 404. The meaning of I, J and K differs between list types and between the printed form and the XSLT ([01 §6](01-furs-doh-kdvp.md#6-acquisition-method-codes-f2-type-typegaintype), verified).

No FURS document we found prescribes a code for RSU or ESPP shares. We checked the instructions, the capital-income and *Bonitete* guides, and the forums. Our recommendation, **low confidence**:

- **ESPP purchase → `B` (nakup).** The employee pays a price, so this is a purchase. Use the purchase-date FMV as `F4`.
- **RSU vest / release → `H` (drugo).** Nothing is paid, and it is not a gift or an inheritance. `B` is also defensible, because Art. 98(3) treats "nakup oziroma pridobitev" together. Make the code configurable.
- **Option exercise-and-hold → `B`**, with `F4` = FMV at exercise (98(3)).
- **`J`** only when the employer applied 45.b (REK-O field A031). Foreign-parent RSUs are never `J`.
- **Never `D`** (basis forced to 0), and never `F` or `G`.

The code does not enter the gain computation, which uses `F4`. The broker error list (KP-KDVP) only ties `Short = DA` to codes B/F/G/H and `Odlog` to E.

### 1.3 Edge cases that change the numbers

- **Vest date vs. deposit date.** Schwab posts RSU shares 1–3 days after `VestDate`, for example `Deposit Date 09/27/2023` with `VestDate 09/25/2023`. The brokerage CSV then shows `"03/18/2026 as of 03/16/2026"`.
  - Use the vest date and the vest FMV, so that `F1`, `F4` and the BSI rate line up with what payroll reported.
  - FURS's wording "dane na razpolago" could be read as the release date. Let users override per lot. Medium confidence.
- **Weekend vests.** In E\*TRADE G&L, `Date Acquired` can be the next business day (08/01/2022) while `Vest Date` is 07/31/2022. The FMV is the same.
- **Net share withholding vs. sell-to-cover.**
  - When the plan *withholds* shares (Schwab `SharesSoldWithheldForTaxes` with an empty `SalePrice`, E\*TRADE `Withheld Qty.` / `Tax Collection Shares`, MS `Net Share Proceeds`), report only the **net** shares as the acquisition. The withheld shares never reached the employee, which is also how cgt-calc treats them.
  - When shares are *sold in the market* to cover tax (a Sale with a sale price, Schwab `Forced Quick Sell`, E\*TRADE "sell-to-cover" orders), report the gross acquisition and a disposal.
  - Such sales often show a small loss, and the retained shares from the same vest fall inside the 30-day window. Expect the loss to be disallowed. **Sources conflict here:** per [04 §5.3](04-si-tax-rules.md#53-wash-sale-rule-pravilo-navidezne-odsvojitve-art-975) (verified), FURS examples 2, 3 and 7 never treat the unsold remainder of the lot being sold as replacement capital. If the sell-to-cover sale consumes the vest lot itself, the retained shares of that vest should therefore not disallow the loss. *Inference:* if older shares of the same stock are held, FIFO matches the sale to them first, and the new vest is then a separate acquisition inside the window. Test both cases against the FURS examples before relying on either reading.
  - Low–medium confidence. FURS has not addressed this case.
- **Foreign tax on sales.** Under Art. 13(5) of the US–Slovenia treaty, gains on shares are taxable only in the state of residence, so `HasForeignTax=false`. US backup withholding (24%, triggered by a missing or expired W-8BEN) is not a creditable foreign tax. Reclaim it from the IRS.
- **Dividend equivalents on unvested RSUs** are not dividends for Doh-Div, because the employee is not yet a shareholder. They are employment income. Medium confidence.
- **ISIN.** No equity-plan export carries an ISIN; they give only a ticker or plan name such as `GSU Class C`. Map ISINs explicitly. The KP-KDVP checks require a 12-character ISIN.
- **Fractional shares** are fine. `F3`, `F4`, `F7` and `F9` allow 8 decimals (`typeDecimalPos12_8` / `typeDecimalPos14_8`).

### 1.4 US dividends (Doh-Div) and W-8BEN

- Rate and deadline: 25% final tax. A self-filed Doh-Div is due **28 February** of the following year (FURS capital-income guide). For TY 2026, 28 Feb 2027 falls on a Sunday; check whether the deadline moves. ([02 §7](02-furs-doh-div-and-others.md#7-deadlines-and-what-changed), verified: the TY2025 deadline moved to Monday 2 March 2026, so TY2026 is expected on 1 March 2027.)
- Reinvested dividends abroad (DRIP, E\*TRADE OSPS) are still dividends. The reinvested shares are a new `B` acquisition.
- Treaty Art. 10(2)(b): US withholding is capped at **15%** when a valid W-8BEN is on file. Without one, 30% is withheld.
- A W-8BEN stays valid until the last day of the third calendar year after signing (IRS). Schwab asks for it "when you open an account and then again every three years".
- `Doh_Div` / `Dividend` element order: `Date, PayerTaxNumber, PayerIdentificationNumber, PayerName, PayerAddress, PayerCountry, Type, Value, ForeignTax, SourceCountry, ReliefStatement`. `Type` is `1` for an ordinary dividend.
- ib-edavki writes `ReliefStatement` = `10/01, 2b odstavek 10. člena` for US payers. (FURS frames that field as a treaty-exemption claim, while US dividends get a credit; see [02 §6](02-furs-doh-div-and-others.md#6-foreign-tax-reliefstatement-and-treaties), verified.)

---

## 2. Platform reference

### 2.1 Charles Schwab Equity Awards (most common)

**Accounts.**

- Equity awards are administered in the Equity Awards (formerly EAC) account.
- Non-US participants hold shares in a linked **Schwab One International** brokerage account, either full or limited purpose. Opening it requires a W-8BEN.

**Exports.** Under Accounts → History, with Equity Awards selected, use **Export** (JSON or CSV). It covers up to 4 years per export, so you have to export several date ranges and merge them. The contents determine which of three layouts a file is:

**(a) Complete JSON**

- Top-level keys: `FromDate`, `ToDate`, `Transactions[]`. Older exports use lower-camel keys: `transactions`, `eventDate`, `totalCommissionsAndFees`, `awardName`, …
- Every row has `Date`, `Action`, `Symbol`, `Quantity`, `Description`, `FeesAndCommissions`, `DisbursementElection`, `Amount`, and `TransactionDetails[{Details:{…}}]`.
- Money values are strings such as `"$1,985.74"`. Dates are `MM/DD/YYYY`.

| Event | `Action` / `Description` | `Details` keys |
|---|---|---|
| RSU vest (net shares) | `Deposit` / `RS` | `AwardDate, AwardId, VestDate, VestFairMarketValue` |
| RSU payroll record | `Lapse` / `Restricted Stock Lapse` | `AwardDate, AwardId, FairMarketValuePrice, SalePrice, SharesSoldWithheldForTaxes, NetSharesDeposited, Taxes` |
| ESPP purchase | `Deposit` / `ESPP` | `PurchaseDate, PurchasePrice, SubscriptionDate, SubscriptionFairMarketValue, PurchaseFairMarketValue, TaxWithholdingMethod, NetSharesDeposited, SharesWithheld, SharesSold, CashRefund, CarryForward` |
| Sale | `Sale` (also `Forced Quick Sell`) / `Share Sale` | one lot each: `Type` (RS/ESPP), `Shares, SalePrice, GrossProceeds, GrantId, VestDate, VestFairMarketValue, PurchaseDate, PurchasePrice, PurchaseFairMarketValue, SubscriptionDate, SubscriptionFairMarketValue, DispositionType`; some exports add `TotalCostBasis, RealizedGainLoss, HoldingPeriod` |
| Dividend / US withholding | `Dividend` / `Credit`; `Tax Withholding` / `Debit`; `Tax Reversal` | none |
| Cash moves (ignore) | `Journal`, `Wire Transfer`, `Forced Disbursement` | none |

**(b) Complete CSV.** Header:

`Date,Action,Symbol,Description,Quantity,FeesAndCommissions,DisbursementElection,Amount,Type,Shares,SalePrice,SubscriptionDate,SubscriptionFairMarketValue,PurchaseDate,PurchasePrice,PurchaseFairMarketValue,DispositionType,GrantId,VestDate,VestFairMarketValue,GrossProceeds,AwardDate,AwardId`

A parent row is followed by detail rows whose first 8 columns are blank.

**(c) Award-price ("Lapse") CSV or JSON.** Header:

`Date,Action,Symbol,Description,Quantity,FeesAndCommissions,DisbursementElection,Amount,AwardDate,AwardId,FairMarketValuePrice,SalePrice,SharesSoldWithheldForTaxes,NetSharesDeposited,Taxes`

It only prices the vests that appear in the brokerage history.

**Brokerage CSV (Schwab One).** Header:

`Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount`

Column order varies, and older files have a trailing empty 9th column.

- Vests appear as `Stock Plan Activity` **with an empty price**, so you need (a), (b) or (c) to get the FMV.
- Dividend actions: `Qualified Dividend`, `Cash Dividend`.
- Withholding actions: `NRA Tax Adj`, `NRA Withholding`, `NRA Withhold`, `Foreign Tax Paid`.

**Schwab pitfalls (from cgt-calc's parser):**

- **Splits are restated inconsistently.** For NVDA, acquisitions are restated but disposals are not. For GOOG, restatement is partial. A `Lapse` row's `Quantity` is restated while its detail counts are not.
- Sale `Quantity` can be rounded while lot `Shares` keep their decimals.
- Since about August 2025, some ESPP purchases settle tax in shares (`TaxWithholdingMethod: "Withhold for Taxes"`). Then `NetSharesDeposited + SharesWithheld + SharesSold` must equal `Quantity`.
- Do not import both the complete export and the brokerage CSV for the same events. They overlap and you would double-count.
- Dates with "as of" carry two dates.
- The per-lot breakdown of a `Sale` is Schwab's own lot choice. Recompute FIFO.

The Slovenian tool Davkomat lists Schwab JSON as supported for shares and dividends.

### 2.2 E\*TRADE from Morgan Stanley (Morgan Stanley at Work stock plan)

Navigation (Morgan Stanley's non-US guide): At Work → Overview, Holdings, Sell, Exercise, Orders, My Account (plan elections, tax elections, stock plan confirmations), Resources, Tax Information.

**`BenefitHistory.xlsx`** (At Work → My Account/Holdings → Benefit History → Download → **Download Expanded**). It has sheets `ESPP` and `Restricted Stock`, and plan-dependent extras such as `OSPS`.

- `ESPP` sheet header:
  `Record Type | Symbol | Purchase Date | Purchase Price | Purchased Qty. | Tax Collection Shares | Net Shares | Sellable Qty. | Est. Market Value | Grant Date | Discount Percent | Grant Date FMV | Purchase Date FMV | Qualified Plan? | Contribution Source | Pending Sale Qty. | Blocked Qty. | Transferable Date | First Sellable Date | Date | Event Type | Qty`
  - `Record Type` values: `Purchase`, `Event`, `Totals`.
  - Dates look like `31-JAN-2025`. `Purchase Date FMV` comes as text, e.g. `$248.05`.
- `Restricted Stock` sheet. Grant rows have:
  `Record Type, Symbol, Grant Date, Settlement Type, Granted Qty., Withheld Qty., Vested Qty., … Grant Number, … Type, …, Date, Event Type, Qty. or Amount, Vest Period, Vest Date, …, Released Qty, Released Amount, …, Total Taxes Paid, Tax Description, Taxable Gain, Effective Tax Rate, Withholding Amount`
  - `Event Type` values include `Shares vested`, `Shares released`, `Shares sold`, `Shares granted`.

**`G&L_Expanded.xlsx`** (My Account → Gains & Losses → Download Expanded). Classic header:

`Record Type, Symbol, Plan Type, Qty., Date Acquired, Acquisition Cost, Acquisition Cost Per Share, Ordinary Income Recognized, Ordinary Income Recognized Per Share, Adjusted Cost Basis, Adjusted Cost Basis Per Share, Date Sold, Total Proceeds, Proceeds Per Share, Gain/Loss, Adjusted Gain/Loss, Adjusted Gain (Loss) Per Share, Term, Order Type, Covered Status, Qualified Plan, Disposition Type, Type, Grant Date, Grant Date FMV, Discount Amount, Purchase Date, Purchase Date Fair Mkt. Value, Purchase Price, Grant Number, 83(b) Election, Vest Date, Vest Date FMV, Exercise Date, Exercise Date FMV, Grant Price, Order Number`

- Newer files insert wash-sale columns: `Date Acquired (Wash Sale Toggle = On)`, `Deferred Loss`, `Gain/Loss (Wash Sale Toggle = On)`, `Capital Gains Status`, `Wash Sale Adjusted Cost Basis`, and others.
- `Plan Type` values: `RS`, `ESPP`, `SO`, `BUY`.
- `Record Type` values: `Summary`, `Sell`.
- `Order Type` values: `Sell Restricted Stock`, `Sell ESPP`.

**E\*TRADE pitfalls:**

- **Do not use `Adjusted Cost Basis` for ESPP.** It equals price + US ordinary income, which differs from FMV on a qualifying disposition: 29.28 vs. `Purchase Date Fair Mkt. Value` 28.538 in a real sample. Use `Purchase Date Fair Mkt. Value` for ESPP and `Vest Date FMV` for RS. `Acquisition Cost` is 0 for RS.
- Ignore every US wash-sale-adjusted column. In localized exports, the date column carries a `12/31/1969` placeholder.
- The XLSX can be localized. The Polish file uses `Data nabycia`, `Data sprzedaży`, `Koszt zakupu`. Match columns by position and synonyms. (The other broker pages, [06 §2](06-brokers-ibkr-t212-revolut.md#2-cross-cutting-rules-for-all-three-parsers) and [07 §3](07-brokers-eu-and-others.md#3-cross-cutting-parser-rules), say never to match by position because column order drifts; the advice conflicts for localized E\*TRADE files.)
- The Orders page shows *Order Date*. The execution date is in Order History ("Order Executed"). Use the execution date.
- Dividends of non-US holders appear on the monthly client statements as `DIVIDEND` / `QUALIFIED DIVIDEND` / `TAX WITHHOLDING`, and on Form 1042-S. There is no lot-level CSV.
- RSU release confirmation PDFs contain `Release Date` (MM-DD-YYYY), `Shares Released`, `Market Value Per Share`.
- TradeLog reports that **on 9 Feb 2026 the E\*TRADE and Morgan Stanley systems merged** and account activity now downloads as CSV/XLSX in a new format. Treat files exported before and after that date as different layouts.

### 2.3 Morgan Stanley at Work (legacy StockPlan Connect; Alphabet GSUs)

These reports are neither Shareworks nor E\*TRADE (cgt-calc docs).

- `Releases Report.csv`: `Vest Date,Order Number,Plan,Type,Status,Price,Quantity,Net Cash Proceeds,Net Share Proceeds,Tax Payment Method`
- `Withdrawals Report.csv`: `Execution Date,Order Number,Plan,Type,Order Status,Price,Quantity,Net Amount,Net Share Proceeds,Tax Payment Method`
- Also present: `Releases Net Shares Report.csv` and `Withdrawal Wire Report.csv`.

Notes:

- Dates are `25-Mar-2021`. `Plan` is `GSU Class C` or `Cash`. Use `Net Share Proceeds` as the acquired quantity.
- Footer: sales on or before 15 Jul 2022 are shown pre-split (20:1). GSU vests are shown post-split.
- An "Autosale" release has a non-zero `Net Cash Proceeds`, and its sale is in a separate report.

### 2.4 Shareworks (Morgan Stanley)

- Computershare bought Shareworks' **European public-company** plan business, Solium Capital UK, in Sept 2023. Many EU plans moved to EquatePlus.
- Morgan Stanley's Shareworks tax guide is US-centric. It covers 1099-B, 3921/3922 and cost-basis adjustment, and says 1042-S is out of scope.
- We found no documented participant CSV schema. Plan for PDF confirmations and statements, or manual entry. Low confidence.

### 2.5 Fidelity Stock Plan Services (NetBenefits / Fidelity Account®)

- Vested RSU shares are deposited, net of withheld shares, into the "Stock Plan Account" / Fidelity Account. Sell-to-cover is optional.
- NetBenefits plan transaction history only covers recent periods (10–120 days, or up to 18 months in 90-day segments). Older data is in statements.
- On the sell ticket, **Share Source** codes are `SP` (ESPP), `RS` (restricted stock), `DO` (deposit only).

**Brokerage history CSV** (`History_for_Account_<n>.csv` / `Accounts_History.csv`):

- Header variants, with BOM and leading blank lines:
  - `Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date`
  - the same with `Quantity`/`Price ($)` swapped
  - `Run Date,Account,Action,Symbol,Security Description,Security Type,Quantity,Price ($),…`
- `Action` is free text: `YOU BOUGHT …`, `YOU SOLD …`, `DIVIDEND RECEIVED …`, `REINVESTMENT …`, `FED TAX W/H …`.
- A quoted disclaimer footer ends with `Date downloaded …` and states the file is "not intended for tax reporting".
- The labels for RSU deposits and for non-resident withholding were **not confirmed** from a primary source. `NON-RESIDENT TAX` in our sample is an assumption.

### 2.6 Computershare (US Employee Online) and EquatePlus

**Ownership history.** Equatex was formerly UBS's CEFS International unit. Computershare completed its acquisition from Montagu on 12 Nov 2018. EquatePlus is now Computershare's platform.

**Legacy Employee Online.**

- Transaction History → choose a plan → **"Export to spreadsheet"**.
- The cost basis is on the year-end statement or the printed transaction-history page.
- RSA/RSU and option "exercise confirmations" are PDFs.
- Non-US participants receive Form 1042-S for US-source dividends.

**EquatePlus.** Library → Transactions. For each sale there are two files:

- a **sale summary PDF**, with labels `Instrument:`, `Execution date:`, `Settlement date:`, `Quantity - Shares … €`, `Foreign exchange`, `Total debits`;
- a **lot "consumption" CSV**. It is semicolon-delimited with a decimal comma, has at least the columns `Acquisition date` (`%d %b %Y`), `Consumption` and `Purchase price`, and shows amounts in the participant's currency (EUR).

Pitfalls:

- EquatePlus converts USD prices at its own FX rate. Recompute from the USD price with the BSI rate. Low confidence on the full column list.

### 2.7 Carta (private companies)

- Employees hold options, RSUs or shares in non-listed companies. Holdings → (grant) → **Documents** gives an Excel file whose `Summary` row includes **"Fair market value on exercise date"** (the 409A FMV). Adjust it for later splits.
- Under 98(3), `F4` is that FMV.
- Sales happen through tenders or M&A. An exchange of shares is a disposal; in a merger the shares received take code `E`. Deferral needs an EU transaction that the company notifies, so a deal between US companies cannot be deferred ([04 §9.1](04-si-tax-rules.md#91-takeovers-and-mergers-paid-in-shares)).
- Shares of a foreign corporation go on PLVP with `Code`/`Name` (no ISIN). LLC-type interests may belong on PLD (`Shares`, with different `F` semantics).
- Low confidence. There is no participant CSV.

---

## 3. A normalized model for contributors

Parse every platform into the events below. Then run a single FIFO and BSI-FX engine over them.

| Normalized event | Fields | Doh-KDVP | Doh-Div |
|---|---|---|---|
| `RSU_VEST` | vest_date, gross_qty, net_qty, fmv_usd, withheld_qty, sold_to_cover_qty, award_id | Purchase: F1 = vest_date, F2 = H (configurable), F3 = net_qty (+ sold_to_cover_qty when a market sale happened), F4 = fmv × BSI(vest_date) | — |
| `ESPP_PURCHASE` | purchase_date, qty_net, purchase_price, fmv_purchase, offering_date, offering_fmv | F2 = B, F4 = fmv_purchase × BSI (never purchase_price or adjusted basis) | — |
| `OPTION_EXERCISE_HOLD` | exercise_date, qty, fmv_exercise, strike | F2 = B, F4 = fmv_exercise | — |
| `SALE` (incl. sell-to-cover, forced quick sell) | trade_date, qty, price_usd, fees | Sale: F6 = trade_date, F7, F9 = price × BSI(trade_date) | — |
| `DIVIDEND` / `DIVIDEND_WHT` / `WHT_REVERSAL` | pay_date, gross_usd, tax_usd | — | Value, ForeignTax (net of reversals), Type = 1 |
| `DRIP` / `OSPS` reinvestment | date, qty, price | F2 = B | the dividend is also reported |
| Ignore | Lapse (if a Deposit exists), Journal, wires, grants, unvested dividend equivalents | — | — |

In the table, "× BSI(date)" is shorthand for converting with the BSI rate of that date. BSI rates are quoted as units of foreign currency per 1 EUR, so the EUR value is the USD amount **divided** by the BSI rate ([03 §1](03-bsi-exchange-rates.md#1-tldr-for-implementers), verified); the worked example below does exactly that.

**Worked example** (synthetic, illustrative FX):

- 16 Mar 2026: 10 RSUs vest at $150, 4 shares withheld, 6 net.
- 30 Jun 2026: 8 ESPP shares bought at $119, purchase-date FMV $160.
- 15 Sep 2026: 10 shares sold at $170.

KDVP rows:

1. H, 6 @ 137.61467890 EUR
2. B, 8 @ 139.13043478 EUR
3. sale, 10 @ 145.29914530 EUR

FIFO matches 6 + 4 shares. The gain is 70.78 EUR, normalized costs 28.35 EUR, base 42.43 EUR, tax at 25% 10.61 EUR. (The research's synthetic Doh-KDVP XML fragment for this example is not committed.)

Using the ESPP price paid ($119) instead would overstate the gain by about 141 EUR on 4 shares, and that is the most common error.

Short synthetic excerpt (Schwab JSON):

```json
{"Date":"03/18/2026","Action":"Deposit","Symbol":"ACME","Quantity":"6","Description":"RS",
 "TransactionDetails":[{"Details":{"AwardDate":"03/15/2025","AwardId":"SYN0001",
 "VestDate":"03/16/2026","VestFairMarketValue":"$150.00"}}]}
```

---

## 4. What changed in 2025–2026

- **TY 2025 (ZDoh-2AB, UL RS 104/24):**
  - new Art. 45.b (taxation of start-up employee shares deferred to a trigger event);
  - Art. 98(10) basis rule and the `J` code;
  - Art. 43 amended (the 65% relief for employer/parent shares has applied since 2022).
- **ZINR (UL RS 40/25):** new code `K` (`I` extended), Art. 98(11) and 101(7) for transfers out of an INR. These are not relevant to equity plans, but the enumeration grew.
- **FURS *Bonitete*, 13th ed. (July 2026), §3.3.3** explains RSUs granted by a foreign group company:
  - the Slovenian employer is the tax payer under ZDavP-2 Art. 58(1)(1.a) and reports on REK-O (VD 1001/1123, or 1089 when the person was not insured in Slovenia);
  - with no payer, the resident self-reports;
  - the value is fixed when the shares are made available.
- **Rates unchanged since 2022:** 25/20/15, 0 after 15 years. Dividends 25%.
- **Platforms:**
  - E\*TRADE and Morgan Stanley merged systems on 9 Feb 2026, giving a new activity export (TradeLog);
  - Schwab ESPP share-withholding fields have appeared since about August 2025 (cgt-calc);
  - E\*TRADE G&L gained wash-sale columns.

## 5. Recommendations

1. Build the cost basis from FMV fields only: `VestFairMarketValue` / `FairMarketValuePrice` / `Vest Date FMV` / `Price` (Morgan Stanley releases), and `PurchaseFairMarketValue` / `Purchase Date FMV` / `Purchase Date Fair Mkt. Value`.
2. Ask users for **all history since the first vest**, across platforms and accounts. FIFO and the 15-year horizon depend on it.
3. Flag sales at a loss within ±30 days of any vest or ESPP purchase.
4. Keep `F2` configurable per event type, with the defaults ESPP = B and RSU = H.
5. Show the vest date and the deposit date side by side, and default to the vest date.

## Confidence

This page was **not independently verified**. The export formats come from open-source parsers and sample files (cgt-calc, etradeTaxReturnHelper, vestwise, EquateTaxCalculator and others) and platform guides; the Slovenian rules come from ZDoh-2, the FURS *Bonitete* and capital-income guides, and the 2025 Doh-KDVP instructions. Where this page overlaps the verified docs (FIFO, FX, rates, F2 legends, Doh-Div rules), the verified docs win.

The researcher rated these critical claims below high confidence:

| Confidence | Claim | Source |
|---|---|---|
| low | No FURS publication prescribes which F2 code to use for RSU or ESPP shares; recommended defaults are B (nakup) for ESPP and H (drugo) for RSU, with B also defensible for RSU. The code does not change the computed gain. | [Doh-KDVP instructions 2025](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf) |
| medium | The 65% reduced benefit valuation under ZDoh-2 Art. 43(6) affects only the employment-income base; FURS states it does not apply to a direct grant of shares as a reward, and Art. 98(3) still sets the KDVP basis at full FMV. | [FURS Bonitete](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_zaposlitve/Opis/Bonitete.docx) |
| medium | A loss on disposal does not reduce the positive tax base if essentially same-type replacement capital is acquired within 30 days before or after the disposal (Art. 97(5)); RSU vests and ESPP purchases of the same stock count as such acquisitions. (The 30-day rule itself is confirmed in 01 and 04, verified; treating vests as acquisitions is this page's reading, and the same-lot caveat in §1.3 applies.) | [Doh-KDVP instructions 2025 (EN)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.en.pdf) |
| medium | Schwab exports restate share counts for later stock splits inconsistently (NVDA: acquisitions restated, disposals not; GOOG: partially), so parsers must normalize splits explicitly before FIFO. | [cgt-calc Schwab parser](https://github.com/cgt-calc/capital-gains-calculator/blob/main/cgt_calc/parsers/schwab_equity_award_json.py) |
| medium | E\*TRADE `BenefitHistory.xlsx` ("Download Expanded") has sheets `ESPP` and `Restricted Stock`; the ESPP sheet columns include Purchase Date, Purchase Price, Purchased Qty., Tax Collection Shares, Net Shares, Grant Date, Discount Percent, Grant Date FMV, Purchase Date FMV, with dates like 31-JAN-2025. | [vestwise sample](https://github.com/ukkit/vestwise/blob/main/sample/BenefitHistory.xlsx) |
| medium | As of 9 February 2026, E\*TRADE and Morgan Stanley systems merged and account activity downloads in a new CSV/XLSX format, so files exported before and after that date need separate parsers. | [TradeLog](https://support.tradelogsoftware.com/hc/en-us/articles/38363821235863-Importing-from-CSV-or-XLSX-E-Trade-Morgan-Stanley-2026) |
| medium | Morgan Stanley at Work (legacy StockPlan Connect) `Releases Report.csv` header is `Vest Date,Order Number,Plan,Type,Status,Price,Quantity,Net Cash Proceeds,Net Share Proceeds,Tax Payment Method` with dates like 25-Mar-2021; the net acquired quantity is `Net Share Proceeds`. | [cgt-calc Morgan Stanley docs](https://github.com/cgt-calc/capital-gains-calculator/blob/main/docs/brokers/morgan-stanley.md) |

Body statements marked "low confidence" or "medium confidence" (vest vs. deposit date, sell-to-cover treatment, dividend equivalents, Shareworks, EquatePlus, Carta, Fidelity labels) carry the same caveat.

**Before shipping a parser:** every fixture derived from this page must be validated against real (anonymized) exports from the platform and export version it claims to represent. The synthetic samples copy headers from public sources only; the post-February-2026 E\*TRADE/Morgan Stanley export, EquatePlus, Shareworks and the Fidelity stock-plan labels have not been confirmed against any real file.

## Open questions

- Which F2 code does FURS expect for RSU shares (B nakup vs H drugo)? No FURS guidance was found; a written FURS query (or a pojasnilo) would settle it.
- Is the KDVP acquisition date for RSUs the vest date (used for the FMV and usually for payroll) or the date the shares were made available/deposited (FURS *Bonitete* §3.3.3 wording "dane na razpolago")? Schwab and E\*TRADE differ by 1–3 days, which can change the BSI rate and the 30-day window.
- How should sell-to-cover sales and net-share withholding be treated: is a market sell-to-cover always a reportable KDVP disposal, and are shares withheld by the employer excluded from both acquisition and disposal? FURS has not addressed this explicitly.
- Does an open ESPP offering period (a contractual right/obligation to buy the same stock) trigger the Art. 97(5) 30-day loss-disallowance rule even when no purchase falls within 30 days?
- What is the exact polarity and eDavki behavior of the F10 flag for RSU holders with frequent vests? It is defined in the furs-doh-kdvp research doc and was not verified here. ([01 §5.2](01-furs-doh-kdvp.md#52-securities-plvp-securitieswithcontract-is-the-same-plus-stockexchangename-max-30-after-isfond) and [04 §5.3](04-si-tax-rules.md#53-wash-sale-rule-pravilo-navidezne-odsvojitve-art-975): column 10 "DA" means the condition for the loss to reduce the base is met, and the display XSLT shows `true` as "Da", but the XSD publishes no true/false semantics and prior-art tools disagree, so an eDavki import test is still needed.)
- Exact column sets of the new post-February-2026 E\*TRADE/Morgan Stanley activity export, the EquatePlus transaction/consumption exports, the Shareworks participant exports, and the Fidelity stock-plan action labels (RSU deposit, non-resident withholding) were not confirmed from primary sources.
- Does the Doh-KDVP deadline for TY2026 (28 Feb 2027 is a Sunday) move to 1 March 2027? ([01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing), verified: the 2026 precedent says yes; medium confidence until FURS announces it.)
- Is the foreign tax credit on Doh-Div limited to the 15% treaty rate when 30% was withheld (no W-8BEN)? This is the expected reading of the treaty; it should be confirmed against the Doh-Div instructions (see the Doh-Div research doc). ([02 §6](02-furs-doh-div-and-others.md#6-foreign-tax-reliefstatement-and-treaties), verified: yes, the credit is capped at the treaty rate and at the Slovenian tax due; the excess must be reclaimed in the US.)
- For Carta and private-company equity: should shares of a foreign C-corp be reported on PLVP (securities, no ISIN) or PLD (deleži), and how should 409A FMV evidence be documented?

## Sources

- [ZDoh-2 Zakon o dohodnini (PISRS, NPB36, in use from 05.03.2026)](https://pisrs.si/pregledPredpisa?id=ZAKO4697)
- [FURS Bonitete – podrobnejši opis (13. izdaja, julij 2026)](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_zaposlitve/Opis/Bonitete.docx)
- [FURS Obresti, dividende, dobiček iz kapitala in dohodek z INR – podrobnejši opis (15. izdaja, avgust 2026)](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Obresti_dividende_in_dobicek_iz_kapitala.doc)
- [Doh_KDVP_9.xsd (eDavki schema)](https://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd)
- [Doh_Div_3.xsd (eDavki schema)](https://edavki.durs.si/Documents/Schemas/Doh_Div_3.xsd)
- [Doh-KDVP instructions 2025 (EN)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.en.pdf)
- [Doh-KDVP instructions 2025 (SL)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf)
- [Doh-KDVP form 2025 (EN)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.i.en.pdf)
- [FURS Seznam napak KP-KDVP](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Seznam_napak_KP-KDVP.pdf)
- [US–Slovenia income tax treaty (IRS)](https://www.irs.gov/pub/irs-trty/slovenia.pdf)
- [IRS Instructions for Form W-8BEN](https://www.irs.gov/instructions/iw8ben)
- [Schwab Equity Awards – accounts for non-U.S. residents](https://eac.schwab.com/overseas-employees)
- [Schwab Equity Awards – W-8BEN guide](https://eac.schwab.com/content/w8ben)
- [cgt-calc Schwab Equity Awards parser (source)](https://github.com/cgt-calc/capital-gains-calculator/blob/main/cgt_calc/parsers/schwab_equity_award_json.py)
- [cgt-calc Schwab broker documentation](https://github.com/cgt-calc/capital-gains-calculator/blob/main/docs/brokers/schwab.md)
- [cgt-calc Morgan Stanley at Work documentation](https://github.com/cgt-calc/capital-gains-calculator/blob/main/docs/brokers/morgan-stanley.md)
- [etradeTaxReturnHelper (E\*TRADE G&L XLSX and statement PDF parser)](https://github.com/RustInFinance/etradeTaxReturnHelper)
- [vestwise (E\*TRADE BenefitHistory.xlsx sample)](https://github.com/ukkit/vestwise)
- [SeFA E\*TRADE parser download instructions](https://github.com/atulgpt/SeFA/blob/main/src/sefa/parser/demat/etrade/README.md)
- [us_equity_uk_employee_cgt (E\*TRADE BenefitHistory ESPP/OSPS parsing)](https://github.com/rdumasia303/us_equity_uk_employee_cgt)
- [tax-etrade (Austrian E\*TRADE RSU/ESPP tool; RSU confirmation PDF fields)](https://github.com/schinivision/tax-etrade)
- [wligithub/tax-tool (E\*TRADE G&L CSV with wash-sale columns)](https://github.com/wligithub/tax-tool)
- [TradeLog: Importing from CSV or XLSX – E\*Trade / Morgan Stanley (2026)](https://support.tradelogsoftware.com/hc/en-us/articles/38363821235863-Importing-from-CSV-or-XLSX-E-Trade-Morgan-Stanley-2026)
- [TradeLog: Importing from XLSX – Morgan Stanley (Legacy)](https://support.tradelogsoftware.com/hc/en-us/articles/360016991173-Importing-from-XLSX-Morgan-Stanley-Legacy)
- [Navigating Your Morgan Stanley at Work Stock Plan Account on etrade.com](https://www.morganstanley.com/cs/pdf/et_account_management_etrade_com_us_noLC.pdf)
- [Fidelity: Understanding and Navigating Your Fidelity Account (Share Source codes)](https://workplaceservices.fidelity.com/bin-public/070_NB_SPS_Pages/documents/dcl/shared/StockPlanServices/SPS_STI_US_UNDERSTANDINGandNAVIGATING_SPA_GUIDE.pdf)
- [Fidelity NetBenefits Help – Restricted Stock Units](https://www.fidelity.com/webxpress/help/topics_isp/learn_rsus.shtml)
- [ofxstatement-fidelity (Fidelity history CSV fixtures)](https://github.com/mooredan/ofxstatement-fidelity)
- [fidelity-sync (Fidelity Accounts_History.csv quirks)](https://github.com/korshak1962/fidelity-sync)
- [FINporterFido (Fidelity history CSV variant with Account column)](https://github.com/open-portfolio/FINporterFido)
- [EquatePlus Guide and FAQs (Computershare) – Export to spreadsheet](https://www-uk.computershare.com/webcontent/Doc.aspx?docid=%7B94b96081-40af-4320-863c-e2ab67bfc89e%7D)
- [EquatePlus Release Notes January 2025](https://content-assets.computershare.com/eh96rkuu9740/3auAE9KgBv0q7nqXmDPTlt/9b72c7abea9779bf776b2d635e88ccac/EquatePlus-Release-67-Notes-EQX.pdf)
- [Computershare to buy Equatex – media statement 16 May 2018](https://content-assets.computershare.com/eh96rkuu9740/67003d003d9443f1bcfab7ab4a1cd681/42ef6fbc0062cff7861dc2ad960884e3/Equatex_Media_Statement_16_May_2018.pdf)
- [Montagu: completion of the sale of Equatex](https://montagu.com/montagu-announces-the-completion-of-the-sale-of-equatex/)
- [EquateTaxCalculator (EquatePlus sale PDF and consumption CSV parser)](https://github.com/sergeykuperman/EquateTaxCalculator)
- [Computershare – information for tax filing (Employee Online / EquatePlus, 1042-S)](https://computershare.com/us/information-for-tax-filing)
- [How to find FMV for previously exercised options on Carta (Secfi)](https://hello.secfi.com/migration/help/how-do-i-find-the-fair-market-value-fmv-for-my-previously-exercised-options-on-carta)
- [Renaulution Shareplan 2024 – Country Supplement Slovenia (SL)](https://renaulutionshareplan.renaultgroup.com/sl/wp-content/uploads/sites/11/2024/07/Renaulution-Shareplan-2024-Country-Supplement-Slovenia-SL.pdf)
- [ib-edavki (Slovenian IBKR converter; US ReliefStatement convention)](https://github.com/jamsix/ib-edavki)
- [Davkomat (Slovenian converter; Schwab JSON support)](https://davkomat.si)
- [Slo-Tech: Obdavčitev nagrade v obliki delnic](https://slo-tech.com/forum/t803284)
- [Slo-Tech: Delniške opcije, obdavčitev](https://slo-tech.com/forum/t718899)
