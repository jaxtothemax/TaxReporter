# Broker export formats: Interactive Brokers, Trading 212, Revolut

> Researched: 2026-10-07 · Verification: not independently verified · Updated: 2026-10-09 (one real Trading 212 export inspected: the `0E-10` zero, dividend prices to 6 decimals, the V4 header and a takeover's rows, §4.2–§4.4; the takeover's tax rule linked from §4.3)
>
> Research for building TaxReporter. It is not tax advice, and FURS publications and the law win over anything written here. Where this page overlaps a verified doc (01–03), the verified doc wins; such places are cross-referenced inline. See the [README](README.md#confidence-and-verification-legend) for the legend.

**Audience:** contributors writing deterministic (no-LLM) parsers that feed Doh-KDVP and Doh-Div.

**Confidence tags used on this page:** **[H]** confirmed in a primary source (broker docs, a real export, or parser code built against real exports), **[M]** consistent across several secondary sources, **[L]** a single or indirect source.

The research produced synthetic fixtures for every format described here, with their arithmetic cross-checked by a validation script. Excerpts are reproduced below; the fixture files themselves are not committed with this page and must be checked against real exports before they become test fixtures (see Confidence).

## 1. At a glance

| | Interactive Brokers | Trading 212 (Invest) | Revolut (Stocks / Invest) |
|---|---|---|---|
| **Primary input** | Activity Flex Query, **XML** | History → Export, **CSV** | Account statement ("Excel" tab → CSV; some users get .xlsx) **plus** the P&L statement CSV |
| Max range per file | 365 days [H] | 12 months / "1 calendar year" [H] | "All time" allowed [M] |
| Time basis | US **Eastern Time**, wall clock [H] | **UTC** [H] | **UTC**, ISO-8601 `…Z` [H]. The 2021-era CSV uses `dd/MM/yyyy HH:mm:ss` [M] |
| ISIN | `isin` attribute [H] | `ISIN` column [H] | **absent** from the account statement. Present in the P&L statement [H] |
| Fees | `ibCommission` + `ibCommissionCurrency`, plus `taxes` [H] | One column per fee, each with its own currency column. Fees are included in `Total` [H] | No fee column. Fees are inside `Total Amount` [M] |
| Dividend WHT | Separate `Withholding Tax` rows [H] | `Withholding tax` column on the dividend row. The dividend itself is **net** [H] | Not in the account statement (`DIVIDEND` is net). The P&L statement gives gross, WHT and net [H] |
| Splits | `CorporateAction` rows (`type` FS/RS/…) [H] | Two rows: `Stock split close` and `Stock split open` [H] | One `STOCK SPLIT` row carrying the **delta** quantity [H] |
| CFDs | Same file, `assetCategory="CFD"` [H] | Separate CFD-account export with a `RecordType` column [H] | Separate CFD statement; `Symbol` such as `XXX:CFD` [M] |

## 2. Cross-cutting rules for all three parsers

1. **Never use the broker's FX rate or realized P&L** for tax figures. IBKR `fxRateToBase`, T212 `Exchange rate`/`Result` and Revolut `FX Rate` are the broker's own rates, and the realized P&L figures use the broker's own lot matching. Convert each amount in its original currency with the BSI rate ([03](03-bsi-exchange-rates.md)). Compute FIFO ourselves across **all** brokers and accounts: the ib-edavki maintainers state that FURS requires FIFO across all accounts and brokers (ib-edavki #171), and [01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing) confirms the rule from the FURS opis (verified).
2. **Dates.**
   - IBKR's `tradeDate` (and the date part of `dateTime`) is the exchange business date in ET. Use it as is. Converting `20260401;202000` ET to Ljubljana time would move a dividend to the next day.
   - T212 and Revolut give UTC instants. Convert them to `Europe/Ljubljana` before taking the date. This only matters near midnight: extended-hours trades and 31 Dec.
3. **Fail closed.** Abort on any unknown `Action`/`Type`/`type` value and on any unknown column that carries a value. Every mature parser does this (cgt-calc, jal). Silently skipping rows was the most common bug in the tools surveyed.
4. **Identify columns by header name**, never by position. T212 has reordered its columns at least twice.
5. **Deduplicate overlapping exports.**
   - IBKR: `transactionID` is unique per row.
   - T212: `ID` is **reused** and is empty on dividends (cgt-calc docs), so use a content fingerprint with the time truncated to the second.
   - Revolut has no ID column at all. Fingerprint on timestamp + ticker + type + quantity + amount.
6. Use exact decimal arithmetic, and strip any UTF-8 BOM before reading the header. eDavki accepts at most 8 decimals on quantities ([01 §7](01-furs-doh-kdvp.md#7-data-formatting-rules)), while T212 exports 10. Rounding each row separately can leave a ±0.00000001 balance (see Neophytez/t212-edavki README).

---

## 3. Interactive Brokers

### 3.1 Obtaining a full history [H]

Client Portal path: **Performance & Reports → Flex Queries → "+" next to Activity Flex Query**. Formats are `XML, CSV, Text (Pipe) or Text (Tab)`. Preset periods run up to "Last 365 Calendar Days".

Recommended query, adapted from the ib-edavki README:

| Section | Options |
|---|---|
| Account Information | Include `IB Entity` and `Account ID` |
| Trades | Options **Executions** + **Closed Lots**, all fields. Do not also tick Orders or Symbol Summary, or rows are double-counted |
| Corporate Actions | All fields |
| Cash Transactions | Dividends, Payment in Lieu of Dividends, Withholding Tax, Broker Interest Received/Paid, Other Fees. Detail level |
| Financial Instrument Information | All fields (gives `issuerCountryCode`, `subCategory`) |
| Transfers | All fields |

Other settings:

- **Delivery:** XML.
- **General configuration:** keep the defaults: date `yyyyMMdd`, time `HHmmss`, date/time separator `;`. ibflex lists the alternatives: `yyyy-MM-dd`, `MM/dd/yyyy`, `MM/dd/yy`, `dd/MM/yyyy`, `dd/MM/yy` and `dd-MMM-yy`; time `HH:mm:ss`; separators `,`, space or none.
- **Run once per calendar year**, from account opening to the current year. Custom ranges and Flex Web Service overrides are limited to **365 days**. Withholding corrections are posted later, so also run the following year.
- **Select every account, including Closed and Migrated ones.** Slovenian clients were moved from IB UK to IB Central Europe in 2021 and to IB Ireland in mid-2024, and received new `U…` account numbers each time (ib-edavki README, #138). One XML file then contains one `FlexStatement` per account.

**Flex Web Service, v3.** Call `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=TOKEN&q=QUERY_ID&v=3`, optionally adding `&fd=yyyymmdd&td=yyyymmdd` (at most 365 days). The response contains `<Status>Success</Status><ReferenceCode>…`; then call `…/GetStatement?t=TOKEN&q=REFERENCE_CODE&v=3`. A `User-Agent` header is mandatory. The token is valid for 6 hours by default.

**Not recommended as primary input:**

- The **Activity Statement CSV**: multi-section rows such as `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code`. `Date/Time` is written `"2017-07-08, 08:53:11"`. It has no ISIN on trade rows.
- The **Transaction History CSV**: amounts are converted to the base currency, and the header is `Gross Amount ` with a trailing space (cgt-calc docs).
- **Flex CSV:** its headers differ from the XML attribute names (for example `ClientAccountID`, `CurrencyPrimary`, `AssetClass`) [M].

### 3.2 XML layout [H]

```text
FlexQueryResponse queryName type="AF"
 └ FlexStatements count
    └ FlexStatement accountId fromDate toDate period whenGenerated   (one per account)
       ├ AccountInformation accountId currency(base) ibEntity …
       ├ Trades      → Trade*, Lot*        (Lot rows follow their closing Trade)
       ├ CorporateActions → CorporateAction*
       ├ CashTransactions → CashTransaction*
       ├ SecuritiesInfo   → SecurityInfo*
       └ Transfers        → Transfer*
```

`ibEntity` values used by ib-edavki are `IB-UK`, `IB-CE`, `IB-IE`, `IB-LUX` and `IBLLC-US`. `IB-CE` has been seen in a real file. Doh-Obr needs the interest payer, so this attribute matters.

### 3.3 `Trade` attributes (XML names from csingley/ibflex `Types.py` and real files)

| Attribute | Meaning / rule |
|---|---|
| `currency` | Trade (instrument) currency. All money attributes are in it |
| `assetCategory` | `STK` (ETFs too: `subCategory="ETF"`), `FUND`, `CFD`, `FXCFD`, `OPT`, `FUT`, `FOP`, `WAR`, `BOND`, `BILL`, `IOPT`, `CASH` (= FX conversion), `CMDTY`, `CRYPTO` |
| `symbol`, `description`, `conid`, `isin`, `cusip`, `figi`, `securityID`, `securityIDType`, `listingExchange`, `issuerCountryCode` | Identifiers. `conid` is IB's id and **changes** on some corporate actions |
| `tradeDate`, `tradeTime` (old files), `dateTime` (newer: `yyyyMMdd;HHmmss`), `settleDateTarget`, `reportDate` | Use `tradeDate` |
| `quantity` | Signed: + buy, − sell. Fractional allowed |
| `tradePrice`, `multiplier` | Price per unit. Multiply by `multiplier` for derivatives |
| `tradeMoney` = quantity×price×multiplier, `proceeds` = −tradeMoney, `netCash` = proceeds + taxes + commission | Signs: a buy has negative `proceeds` and `netCash` |
| `ibCommission` (≤0), `ibCommissionCurrency` | Commission. The currency may differ from `currency` |
| `taxes` | Transaction taxes such as FTT or stamp duty. Add them to the cost |
| `openCloseIndicator` | `O`, `C`, `C;O` (closes and reopens the opposite side), `-` |
| `buySell` | `BUY`, `SELL`, `BUY (Ca.)`, `SELL (Ca.)` (cancellations) |
| `transactionType` | `ExchTrade`, `BookTrade`, `TradeCancel`, `TradeCorrect`, `FracShare`, `FracShareCancel`, `DvpTrade` |
| `notes` | `;`-separated codes: `O` open, `C` close, `P` partial, `Ca` canceled, `Co` corrected, `FP`/`RP` fractional principal / riskless principal, `LT`/`ST`, `Ex`, `A`, `Ep`, `R` reinvestment, `Re` reversal, `Po` posting |
| `levelOfDetail` | `EXECUTION`, `ORDER`, `CLOSED_LOT` (on `Lot`), `SYMBOL_SUMMARY`, `ASSET_SUMMARY`. Ingest **EXECUTION only**, and read `CLOSED_LOT` only as a cross-check |
| `transactionID` | Unique row key. `Lot.transactionID` points at the **opening** trade |
| `cost`, `fifoPnlRealized`, `openDateTime`, `holdingPeriodDateTime` | IB's lot data. Use for reconciliation only |

A note on the "Add them to the cost" advice for `taxes`: per [01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing) (verified), actual commissions are not added to F4/F9 on Doh-KDVP, because eDavki applies flat 1% + 1% costs. Whether transaction taxes are treated differently is not settled here.

### 3.4 Cash transactions [H]

The `type` literals are:

- `Dividends`
- `Payment In Lieu Of Dividends`
- `Withholding Tax`
- `Broker Interest Received`, `Broker Interest Paid`
- `Bond Interest Received`, `Bond Interest Paid`
- `Other Fees`, `Advisor Fees`
- `Commission Adjustments`
- `Deposits/Withdrawals` (older files: `Deposits & Withdrawals` or `Deposits`)

Other attributes: `amount` is signed; `dateTime` is the pay date and time in ET; also `settleDate`, `reportDate`, `exDate` (newer files), `description`, `symbol`, `conid`, `isin`, `transactionID`, `actionID`, `levelOfDetail`, `code`.

Description patterns:

- `KO(US1912161007) CASH DIVIDEND USD 0.53 PER SHARE (Ordinary Dividend)`
- `… - US TAX`
- `… PAYMENT IN LIEU OF DIVIDEND (Ordinary Dividend)`
- reversals: `… - REVERSAL (Ordinary Dividend)` with a negative amount

Rules learned from ib-edavki:

- Skip `levelOfDetail="SUMMARY"` rows. Their `transactionID` is empty and they duplicate the `DETAIL` rows (#160).
- A WHT row with an empty `conid`/`symbol` is tax on interest, not on a dividend.
- No key links a WHT row to its dividend in the files ib-edavki was written against. It matches on same symbol + same date + lower transactionID, then on description similarity. `actionID` exists in newer files, but nobody has verified it as a link.
- A reversal can be followed by a re-booking whose quantity or rate differs slightly (#136). Net reversals by ISIN + date + amount, and flag anything left unmatched.

### 3.5 Corporate actions [H]

The two-letter `type` codes from the IBKR reporting guide:

| Code | Meaning | Code | Meaning |
|---|---|---|---|
| FS | Forward split | RS | Reverse split |
| FI | Issue forward split | CS | Contract split |
| SO | Spin off | SD | Stock dividend |
| TC | Merger | TO | Voluntary conversion |
| TI | Tender issue | IC | Issue change |
| DW | Delist worthless | BM | Bond maturity |
| RI | Subscribable rights issue | SR | Subscribe rights |
| DI | Dividend rights issue | ED | Expire dividend right |
| HI / HD | Choice dividend issue / delivery | CD | Cash dividend |
| CO | Contract spin off | CC | Contract consolidation |
| CA | Contract soulte | CI | Convertible issue |
| BC | Bond conversion | CP | Coupon payment |
| PI | Share purchase issue | PC | Partial call issue |
| OR | Asset purchase | GV | Generic voluntary |
| FA | Fee allocation | TM | T-bill maturity |
| UE | Unknown event | | |

How corporate actions are represented:

- `quantity` is the signed position change. Use it, not a ratio parsed from `description`.
- **ISIN-changing reverse splits** produce two rows with the same `actionID`: the old leg has symbol `XXX.OLD`, the old ISIN and a negative quantity; the new leg has the new ISIN/conid and a positive quantity. There may be **no** separate `CUSIP/ISIN CHANGE` row (ib-edavki #181, #213, e.g. WEAT 2025-11-24, PRSO).
- Mergers appear as `MERGED(Acquisition) WITH <ISIN> a FOR b` (#205).
- Spin-offs and stock dividends cannot be valued from the export (#177).

### 3.6 Other sections

- **`Transfer`** attributes: `type` (`ACATS`, `ATON`, `FOP`, `INTERNAL`, `INTERCOMPANY`, `OTC`), `direction` (`IN`/`OUT`), `quantity`, `transferPrice` (often 0, so the cost basis must come from the user), `positionAmount`, `company`, `account`, `deliveringBroker`, `date`/`dateTime`, `transactionID`.
- **`SecurityInfo`** gives `isin`, `subCategory`, `issuerCountryCode`, `type`, `currency`, `multiplier`.
- **Numbers** are plain decimals with `.`, no grouping, and `-` for negatives.

### 3.7 Version drift and detection

How to detect the format: the root element is `FlexQueryResponse` and `type="AF"`.

Known drift:

- `dateTime` replaced `tradeDate` + `tradeTime` on trades. Old files may carry ISO dates or `", "` separators, e.g. `2013-03-05, 19:45:00`.
- The `Deposits/Withdrawals` spelling changed (see §3.4).
- `exDate`, `actionID`, `figi` and `issuerCountryCode` appeared in newer files.
- The account number and entity change at each migration (§3.1).

If `fromDate` is 8 digits, assume the default date format; otherwise reject the file and ask the user to restore the defaults.

### 3.8 Fixture (excerpt of the synthetic `ibkr-flex-activity-2026-synthetic.xml`)

```xml
<FlexQueryResponse queryName="TaxReporter-SI" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U16000001" fromDate="20260101" toDate="20261231" period="" whenGenerated="20270105;101500">
<AccountInformation accountId="U16000001" currency="EUR" ibEntity="IB-IE" />
<Trades>
<Trade currency="USD" fxRateToBase="0.8621" assetCategory="STK" subCategory="COMMON" symbol="AAPL" conid="265598" isin="US0378331005" dateTime="20260210;101502" tradeDate="20260210" transactionType="ExchTrade" quantity="-4" tradePrice="230" tradeMoney="-920" proceeds="920" taxes="0" ibCommission="-1" ibCommissionCurrency="USD" netCash="919" openCloseIndicator="C" cost="-600.4" fifoPnlRealized="318.6" buySell="SELL" transactionID="700000102" levelOfDetail="EXECUTION" />
<Lot currency="USD" assetCategory="STK" symbol="AAPL" isin="US0378331005" tradeDate="20260210" quantity="4" tradePrice="150.1" cost="600.4" openCloseIndicator="C" transactionID="700000001" openDateTime="20250303;101500" levelOfDetail="CLOSED_LOT" />
<Trade currency="EUR" assetCategory="CFD" symbol="SAP" isin="" underlyingSecurityID="DE0007164600" quantity="10" tradePrice="200" ibCommission="-3" buySell="BUY" transactionID="700000104" levelOfDetail="EXECUTION" />
</Trades>
<CorporateActions>
<CorporateAction symbol="ACME" isin="US00000ACMN2" description="ACME(US00000ACME1) SPLIT 1 FOR 10 (ACME, ACME CORP, US00000ACMN2)" quantity="5" type="RS" actionID="600000202" dateTime="20260519;202500" />
<CorporateAction symbol="ACME.OLD" isin="US00000ACME1" description="ACME(US00000ACME1) SPLIT 1 FOR 10 (ACME.OLD, ACME CORP, US00000ACME1)" quantity="-50" type="RS" actionID="600000202" dateTime="20260519;202500" />
</CorporateActions>
<CashTransactions>
<CashTransaction currency="USD" symbol="KO" isin="US1912161007" description="KO(US1912161007) CASH DIVIDEND USD 0.53 PER SHARE (Ordinary Dividend)" dateTime="20260401;202000" exDate="20260313" amount="15.9" type="Dividends" transactionID="700000301" levelOfDetail="DETAIL" />
<CashTransaction currency="USD" symbol="KO" isin="US1912161007" description="KO(US1912161007) CASH DIVIDEND USD 0.53 PER SHARE - US TAX" dateTime="20260401;202000" amount="-2.39" type="Withholding Tax" transactionID="700000302" levelOfDetail="DETAIL" />
</CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>
```

### 3.9 Pitfalls hit by existing tools

- **`C;O` trades.** ib-edavki splits each one into a close and an open, but its lookup cache kept pointing at the stale original row. As a result, 54 closing lots silently lost their opener (#213).
- **Long and short positions in different accounts** violate eDavki's running-inventory rule unless trades are re-merged chronologically (#213). (That eDavki rejects such files is unverified; see [01 Verification](01-furs-doh-kdvp.md#verification).)
- **Fractional cash-in-lieu after a reverse split** appears as a sale with no matching buy (#121).
- **Split ratios.** ib-edavki parses them with the regex `SPLIT (.+) FOR (.+) \(`. Use `quantity` instead.
- **Commission is ignored** by ib-edavki, which uses `tradePrice` only.
- **Rate fallbacks.** ibkr2dohkdvp converts with ECB/Frankfurter API rates and has hard-coded fallback rates.

---

## 4. Trading 212 (Invest account)

### 4.1 Obtaining

**In the app: ☰ → History → Export.** Choose the timeframe and the data types (Orders, Dividends, Transactions, Interest), then **Generate**. Past files are under "Recent exports".

- Each file covers at most **1 calendar year / 12 months** (2021 launch announcement; CFD help article). Loop over consecutive ranges from account opening with no gaps.
- Observed file name pattern: `from_YYYY-MM-DD_to_YYYY-MM-DD_<base64 of export epoch-ms>.csv` [M].
- **Public API (beta, Invest/ISA only):**
  - `POST /api/v0/equity/history/exports` with body `{"dataIncluded":{"includeDividends","includeInterest","includeOrders","includeTransactions"},"timeFrom","timeTo"}`. Rate limit: 1 request / 30 s.
  - `GET /api/v0/equity/history/exports` returns `status` (`Queued`, `Processing`, `Running`, `Canceled`, `Failed`, `Finished`) and `downloadLink`.
  - Hosts: `live.trading212.com`, `demo.trading212.com`. Authentication: HTTP Basic with key and secret.
- The **CFD account** has its own export with a `RecordType` column (`CLOSED_POSITION`, `ORDER`, `TRANSACTION`, …). Route it to D-IFI, never to KDVP.

### 4.2 Columns (the header is dynamic: fee and tax columns appear only when used)

| Column | Meaning |
|---|---|
| `Action` | See §4.3 |
| `Time` → `Time (UTC)` (2026) | UTC. Seen as `2020-06-24 04:06:06`, `2023-12-18 14:30:03.613`, `2026-03-01 01:10:00+00:00`. Accept an optional fraction and an optional `+00:00`/`Z` |
| `ISIN`, `Ticker`, `Name` | `Name` is quoted. Tickers can be venue aliases (e.g. `NVD` under the NVIDIA ISIN), so key on the ISIN |
| `Notes`, `ID` | `ID` is `EOF…` for orders, a UUID for cash rows, and empty for dividends. It can be reused |
| `No. of shares` | Up to 10 decimals |
| `Price / share`, `Currency (Price / share)` | In the instrument currency. `GBX` means pence: divide by 100. On dividend rows the price is **net of WHT** |
| `Exchange rate` | Trade rows: instrument-currency units per 1 account-currency unit (`EUR = qty×price / rate`). Dividends: `Not available` until late 2025, then **the inverse direction** (account per instrument) |
| `Result` + `Currency (Result)` | T212's own realized P&L. Ignore it |
| `Total` + `Currency (Total)` | Cash moved, in the account or sub-account currency. **Unsigned** for buys and sells; fees are added on buys and deducted on sells. Negative for withdrawals and card debits |
| `Withholding tax`, `Currency (Withholding tax)` | Usually in the instrument currency |
| `Currency conversion fee` (+ currency), `Transaction fee`, `Finra fee`, `Stamp duty reserve tax`, `French transaction tax`, `Deposit fee` (each + `Currency (…)`) | Transaction costs |
| `Currency conversion from amount` / `to amount` (+ currencies) | Multi-currency accounts (2025+) |
| `Merchant name`, `Merchant category` | 212 card spending. Ignore |

Seen in one real export, generated in October 2026 for the year 2025 (not committed; its header is in the fixture `t212-invest-v4-2026-takeover.csv`):

- **A zero kept to 10 decimals is written `0E-10`** [H], the scientific form a decimal library gives a zero with more than six places. Both rows of a takeover paid in shares were priced this way, while the 2-decimal columns, `Total` and `Withholding tax`, wrote zero as `0.00`. Read the form as 0 in `No. of shares` and `Price / share`, the columns kept to 10 decimals (a dividend's price to 6, below). By the same rule a value under 0.000001 would be written like `1.234E-7`; neither that nor the form in another column has been seen, so the parser refuses both.
- **Dividend prices have 6 decimals** [H], not 10. The net-of-WHT rule held: on US dividends the tax withheld was 15% of `shares × price / 0.85`.
- **`Notes` was left out** of the header [H] of this export, in which no row had a note.

### 4.3 `Action` values [H unless noted]

| Group | Values |
|---|---|
| Trades | `Market buy`, `Limit buy`, `Stop buy`, `Stop limit buy`, `Market sell`, `Limit sell`, `Stop sell`, `Stop limit sell` |
| Dividends | `Dividend (Dividend)`, `Dividend (Ordinary)`, `Dividend (Dividends paid by us corporations)`, `Dividend (Dividends paid by foreign corporations)`, `Dividend (Dividend manufactured payment)`, `Dividend (Property income distribution)`, `Dividend (Tax exempted)`, `Dividend (Interest)` (fund interest distribution), `Dividend adjustment`; `Dividend (Bonus)`, `Dividend (Property income)` [L] |
| Corporate actions | `Stock split open` and `Stock split close` (each states the **full** position after or before the split), legacy `Stock Split`, `Spin off`, `Stock distribution`, `Custom stock distribution`, `Transfer in`, `Transfer out`; `Equity rights` [L] |
| Cash | `Deposit`, `Withdrawal`, `Interest on cash`, `Lending interest`, `Currency conversion`, `Result adjustment`, `Spending cashback`, `Card debit`, `Card credit`, `Card refund` |

**Gross dividend for Doh-Div** = `No. of shares × Price / share + Withholding tax`, when the WHT currency equals the price currency. This is cgt-calc's rule, verified on real exports from 2020 to 2026 (#1203).

**Takeovers paid in shares** appear as a `Market sell` with a price of 0 and a `Total` of 0; the new shares arrive via `Stock distribution`, or not at all. Treat this as a hard error requiring manual input. The tax rule, a disposal valued at the market price on the date the exchange took effect, is in [04 §9.1](04-si-tax-rules.md#91-takeovers-and-mergers-paid-in-shares).

In the real 2025 export of §4.2, the takeover matched that description, with these details [H]:

- The two rows came 15 seconds apart, both priced `0E-10`, with a `Total` of `0.00` and no exchange rate.
- The `Stock distribution` quantity was the sale's times the published exchange ratio.
- Both rows were dated several days after the merger completed, so a row's time is when T212 booked it, not the date of the exchange. Any input the user gives for a takeover has to carry its own date and value.
- `Result` on the sale was minus the position's whole cost. That is T212's write-off, not a tax figure.
- A `Custom stock distribution` row booked subscription rights at a price of `0E-10`, under a name ending in `- CorpAct` and a ticker ending in `.RST`. Its tax treatment is an open question ([04](04-si-tax-rules.md#open-questions)).

### 4.4 Versions and how to detect them

The dates below are approximate.

| Version | Header signature |
|---|---|
| V1 (2021–~2022) | Currency suffix in the header: `Result (EUR)`, `Total (EUR)`, `Charge amount (EUR)`, `Transaction fee (GBP)`, `Stamp duty (GBP)`; `Notes,ID` near the end. At launch, names containing commas were not quoted (a bug, since fixed) |
| V2 (~2023–2024) | `Result,Currency (Result),Total,Currency (Total)`; `Notes,ID` after the WHT columns |
| V3 (2025–Jan 2026) | `Notes,ID` move to right after `Name`; conversion and merchant columns added. Real header from cgt-calc #709 (Jan 2026): `Action,Time,ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Currency conversion from amount,Currency (Currency conversion from amount),Currency conversion to amount,Currency (Currency conversion to amount),Currency conversion fee,Currency (Currency conversion fee),Merchant name,Merchant category` |
| V4 (2026) | The first column after `Action` is named `Time (UTC)`. The revision depends on when the export is generated, not the period it covers: a 2025 period exported in October 2026 has this header |

Detection rules:

- A `RecordType` column means a CFD export: reject it for KDVP.
- Prices are rounded to cents in exports up to early 2024.

### 4.5 Fixture (synthetic `t212-invest-v4-2026-eur-synthetic.csv`)

```csv
Action,Time (UTC),ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),French transaction tax,Currency (French transaction tax),Currency conversion fee,Currency (Currency conversion fee)
Deposit,2026-01-05 08:00:12+00:00,,,,"Bank Transfer",00000000-0000-7000-8000-000000000201,,,,,,,2000.00,"EUR",,,,,,
Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,"Coca-Cola",,EOF0000003001,20.0000000000,69.5000000000,USD,1.17250000,,,1187.28,"EUR",,,,,1.78,"EUR"
Market buy,2026-01-07 09:00:05+00:00,FR0000121014,MC,"LVMH",,EOF0000003002,0.5000000000,600.0000000000,EUR,1.00000000,,,300.90,"EUR",,,0.90,"EUR",,
Stock split close,2026-03-02 07:00:00+00:00,US00000ACME1,ACME,"Acme Corp",,EOF0000003003,3.0000000000,300.0000000000,USD,1.16000000,0.00,"EUR",775.86,"EUR",,,,,,
Stock split open,2026-03-02 07:00:00+00:00,US00000ACME1,ACME,"Acme Corp",,EOF0000003004,9.0000000000,100.0000000000,USD,1.16000000,,,775.86,"EUR",,,,,,
Dividend (Dividend),2026-04-01 12:10:44+00:00,US1912161007,KO,"Coca-Cola",,,20.0000000000,0.4335000000,USD,0.85470000,,,7.41,"EUR",1.53,USD,,,,
Limit sell,2026-05-15 15:00:01+00:00,US1912161007,KO,"Coca-Cola",,EOF0000003005,8.0000000000,72.1000000000,USD,1.13000000,34.76,"EUR",509.67,"EUR",,,,,0.77,"EUR"
```

The research also produced a V3 fixture built from the real cgt-calc #709 header (`t212-invest-v3-2025-eur-synthetic.csv`) and a V1 illustration (`t212-invest-v1-2022-eur-illustrative.csv`); neither is committed.

### 4.6 Pitfalls

- **Neophytez/t212-edavki and zvranesic/t212-edavki:**
  - They filter `buy|sell` rows only and hard-code split lists (zvranesic), so `Stock split open/close` rows are ignored.
  - zvranesic requires a column literally named `Time`, which breaks on V4.
  - Neophytez uses ECB rates for USD only and T212's own rate for other currencies.
  - zvranesic deduplicates on (Time, Action, ISIN, qty, price), which collapses genuine identical fills.
  - The 10-to-8 decimal rounding residue described in §2.
- **DeclaRenta** treats the dividend `Total` as gross. It is net.
- **cgt-calc**, the most complete parser, refuses: Transfer in/out, Stock distribution, zero-price sells, and splits where the two halves disagree.

---

## 5. Revolut (Stocks / Invest)

### 5.1 Obtaining

**Invest → More → Documents → Stocks → Account statement → "Excel" → Period "All time"** (cgt-calc docs, Revolut help). Also download, per tax year, the **Profit and Loss statement** in Excel/CSV.

- Observed file names: `trading-account-statement_2020-03-10_2024-12-31_en-us_891b6e.csv`, `trading-pnl-statement_<from>_<to>_<locale>_<hash>.csv`, or a UUID `.csv`.
- At least one 2026 tool reports `.xlsx` with the same columns (DeclaRenta). **Sniff the content**: a `PK` header means XLSX.
- Do not parse the localized multi-section **consolidated statement**. It uses locale number formats such as `"273,30 PLN"` and translated headers.
- The help pages cited here returned HTTP 403 to automated fetches, so the UI path comes from search-result summaries [M].

**Entity history.** Revolut Trading Ltd (UK) migrated EEA clients to **Revolut Securities Europe UAB** (Vilnius). Custody stayed with DriveWealth through an omnibus account. The migration shows up as zero-value `TRANSFER FROM …` rows; observed dates are 2023-06-25 and 2023-08-06. EU-listed stocks were added in Oct 2023, and appear as `Currency=EUR` rows with tickers like `RHM`, without an ISIN.

### 5.2 Account statement [H]

Header, exactly: `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate`.

| Type | Semantics |
|---|---|
| `BUY - MARKET`, `BUY - LIMIT`, `BUY - STOP` | `Total Amount` = qty×price **+ commission** |
| `SELL - MARKET`, `SELL - LIMIT`, `SELL - STOP` | `Total Amount` = qty×price **− fees** |
| `DIVIDEND` | **Net** of WHT. No WHT column |
| `DIVIDEND TAX (CORRECTION)` | Signed. Usually ± pairs that cancel within a second; a lone row is real tax |
| `STOCK SPLIT` | `Quantity` = **shares added** (negative for a reverse split, e.g. `-119.7`); `Total` 0 |
| `MERGER - STOCK` / `MERGER - CASH` | Shares removed (negative quantity) and the cash paid: a **disposal** |
| `RETURN OF CAPITAL`, `BOND COUPON` (the ticker is the bond's ISIN), `POSITION CLOSURE` (e.g. warrants cashed out), `REWARD` | Need classification. Do not drop them |
| `CASH TOP-UP`, `CASH WITHDRAWAL`, `CUSTODY FEE`, `CUSTODY FEE REVERSAL` | Cash |
| `TRANSFER FROM REVOLUT TRADING LTD TO REVOLUT SECURITIES EUROPE UAB`, `TRANSFER FROM REVOLUT BANK UAB TO REVOLUT SECURITIES EUROPE UAB` | Internal entity move. **Not** an acquisition or disposal |
| v1-only: `BUY`, `SELL`, `CUSTODY_FEE` | 2021-era spelling |

Other columns:

- `FX Rate` is Revolut's rate: instrument-currency units per 1 user base-currency unit (≈1.10 for EUR users holding USD). Ignore it.
- `Quantity` has up to 8 decimals.
- The `Currency` column is the instrument currency.

### 5.3 Versions

| Version | Date column | Amounts | Types |
|---|---|---|---|
| Legacy (2019–2021) | Monthly PDFs (DriveWealth) | — | Activity codes `BUY`, `SELL`, `DIV`, `DIVNRA` (WHT), `SSP` (split), `MAS` (merger), `SC` (symbol change), `CDEP`, `CSD` [L] |
| CSV v1 (exports ~2021–2022) | `10/03/2020 17:48:01` | Plain, e.g. `30.00`; `FX Rate` with 10 decimals | `BUY`, `SELL`, `CUSTODY_FEE` [M] |
| CSV v2 (exports ~2022–early 2025) | `2024-12-30T09:59:39.090162Z` | `$1,020.29` (quoted when it contains a comma), `-$30.93`, `€88.94` | `BUY - MARKET`, … [H] |
| CSV v3 (exports 2025–2026) | ISO `Z` | `USD 1197.08`, `USD -0.04`, `EUR 773`. No grouping, no quotes | v2 set plus `BOND COUPON`, `MERGER - *`, `RETURN OF CAPITAL`, `POSITION CLOSURE`, `REWARD` [H] |

Detection: read the date shape and the amount prefix from the first data row. The version follows the **export** date, not the transaction date.

### 5.4 Profit & Loss statement (needed for ISIN, country and WHT) [H]

```csv
Income from Sells
Date acquired,Date sold,Symbol,Security name,ISIN,Country,Quantity,Cost basis,Gross proceeds,Gross PnL,Currency
2024-01-10,2024-06-20,AAPL,Apple,US0378331005,US,1,185.67,208.33,22.66,USD

Other income & fees
Date,Symbol,Security name,ISIN,Country,Gross amount,Withholding tax,Net Amount,Currency
2024-02-16,AAPL,Apple,US0378331005,US,0.60,0.09 USD,0.51 USD,USD
```

Quirks:

- Section lines may carry trailing commas.
- `Withholding tax` and `Net Amount` carry currency suffixes (`92.57 PLN`, and even `$0`).
- Real Polish exports report dividends converted to the base currency, so the currency semantics are not reliable [M].
- Variants with `… base currency` and `Fees`/`Net PnL` columns exist.

Recommended use:

1. Take the trades from the account statement.
2. Take ISIN, country and WHT from the P&L statement.
3. Reconcile the net amounts per date and ticker.

### 5.5 CFD statement [M]

The header is `Date,Symbol,Type,Quantity,Price,Total Amount,Margin,Fees,Currency,FX Rate`. Symbols look like `NVDA:CFD`. Extra types: `COMMISSION CHARGE`, `OVERNIGHT FEE`. It goes to D-IFI only.

### 5.6 Fixture (synthetic `revolut-account-statement-v3-iso-2026-synthetic.csv`, excerpt)

```csv
Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2023-08-06T09:15:38.297396Z,MSFT,TRANSFER FROM REVOLUT TRADING LTD TO REVOLUT SECURITIES EUROPE UAB,2.44716214,,USD 0,USD,1.1018
2025-02-04T08:07:26.609Z,ACM1,BUY - MARKET,1,EUR 773,EUR 773,EUR,1.0000
2025-03-03T14:40:51.929542Z,ACME,BUY - MARKET,0.75,USD 2400.00,USD 1801.00,USD,1.0490
2025-06-11T09:19:41.672692Z,MSFT,DIVIDEND,,,USD 1.66,USD,1.1420
2025-07-02T20:17:03.017632Z,MSFT,DIVIDEND TAX (CORRECTION),,,USD -0.37,USD,1.1825
2025-07-02T20:17:03.087519Z,MSFT,DIVIDEND TAX (CORRECTION),,,USD 0.37,USD,1.1825
2025-08-20T05:13:05.927026Z,ACME,STOCK SPLIT,14.25,,USD 0,USD,1.1650
2025-10-02T14:31:41.907Z,MSFT,SELL - LIMIT,2.44716214,USD 515.00,USD 1259.29,USD,1.1742
2025-11-02T05:27:50.661409Z,OLDCO,MERGER - CASH,,,USD 1409.20,USD,1.1589
```

The research also produced v1, v2, P&L and CFD fixtures in the same style; they are not committed.

### 5.7 Pitfalls

- **No ISIN.** Ticker collisions across venues are a risk (EU listings), and bonds use the ISIN as the ticker.
- **Fees are only implicit**, and the price is rounded to 2 decimals. cgt-calc recomputes the price as `Total/Quantity`.
- **Revolut's own FX rate** is used by JakaCikac/revolut-edavki.
- **The P&L sells section** is used as the KDVP source by jsitla/Revolut-tax-investing-account, which ignores BSI conversion ("uses values as in CSV").
- **CSV format changes** broke revolut-stocks (discontinued) and revoprofit (`CUSTODY FEE REVERSAL`).
- An AI-written GitHub issue (DeclaRenta #56) invented a non-existent `Symbol,ISIN,Type,…` header. **Only trust headers seen in real exports.**

---

## 6. Normalized event model

Every parser should emit the same model:

- `Acquire` / `Dispose` (ISIN, qty, price, ccy, fees[ccy], trade date)
- `Dividend` (gross, ccy, pay date, WHT[ccy], ISIN, country)
- `Split` (ISIN, Δqty or old→new qty)
- `IdentifierChange` (old ISIN → new ISIN)
- `TransferIn` / `TransferOut` (cost basis unknown)
- `CashOnly`
- `Unsupported` (blocking)

Route CFD, OPT, FUT, FOP and WAR instruments to a separate D-IFI stream.

## Confidence

This page was **not independently verified**. The format descriptions come from broker documentation, open-source parsers built against real exports, and their issue trackers. One real Trading 212 export of 2025 was inspected later, for the notes in §4.2 and §4.3 that say so; no other real export from a Slovenian account was inspected for this page. Body statements tagged [M] or [L] carry the same caveat as the claims below. Where this page overlaps the verified docs (FIFO, decimals, inventory rules), the verified docs win.

The researcher rated these critical claims below high confidence:

| Confidence | Claim | Source |
|---|---|---|
| medium | Trading 212 `Exchange rate` on trade rows is instrument-currency units per 1 account-currency unit (EUR value = shares × price / rate); dividend rows show `Not available` in older exports and, since late 2025, a rate in the opposite direction. | [cgt-calc #1203](https://github.com/cgt-calc/capital-gains-calculator/issues/1203) |
| medium | Trading 212 exports share quantities with up to 10 decimals while eDavki accepts at most 8, producing rounding residues (e.g. −0.00000001 inventory) unless rounding is reconciled. | [Neophytez/t212-edavki](https://github.com/Neophytez/t212-edavki) |
| medium | Revolut `Total Amount` already includes commissions (BUY total = qty × price + fee; SELL total = qty × price − fees); there is no separate fee column, and the price is rounded, so the effective unit price is Total/Quantity. | [cgt-calc Revolut docs](https://github.com/cgt-calc/capital-gains-calculator/blob/main/docs/brokers/revolut.md) |
| medium | Revolut amount formatting changed with export date: older CSVs use plain numbers with `dd/MM/yyyy HH:mm:ss` dates and types BUY/SELL/CUSTODY_FEE; later exports use ISO-8601 UTC `Z` timestamps with currency-symbol amounts like `$1,020.29`/`-$30.93`; 2025–2026 exports use ISO-code prefixes like `USD 1197.08`/`USD -0.04`. | [ulyssetsd/revoprofit](https://github.com/ulyssetsd/revoprofit) |
| medium | Revolut `MERGER - STOCK` (negative quantity) plus `MERGER - CASH` (cash amount) represent a cash takeover, i.e. a disposal that must appear in Doh-KDVP; other types such as RETURN OF CAPITAL, BOND COUPON, POSITION CLOSURE and REWARD also occur in 2024–2026 exports. | [webamMarko/revolut-edavki-converter examples](https://github.com/webamMarko/revolut-edavki-converter/tree/main/examples) |

**Before shipping a parser:** every fixture derived from this page must be validated against real (anonymized) exports from the broker and export version it claims to represent. The synthetic fixtures copy headers from public sources and were checked only for internal arithmetic, not against a real Slovenian account. The Trading 212 V4 header has since been compared with one real export: the same columns in the same order, less those it had no use for (§4.2).

## Open questions

- Revolut help-center pages (help.revolut.com) return HTTP 403 to automated fetches; the exact current in-app path and whether the "Excel" option yields .csv or .xlsx for Slovenian (RSEUAB) users should be confirmed manually with a real 2026 export.
- Exact date when Revolut switched account-statement amounts from `$1,234.56` to `USD 1234.56` (observed between early-2025 and early-2026 exports) and the time zone of the 2021-era `dd/MM/yyyy HH:mm:ss` CSV dates are unconfirmed.
- Currency semantics of the Revolut P&L statement "Other income & fees" section for EUR-base users: are Gross amount / Withholding tax in the instrument currency (USD) or converted to EUR at Revolut's rate? Polish samples show base-currency (PLN) values with mixed suffixes.
- Exact column list of the new Trading 212 CFD-account CSV export (only `RecordType` values like CLOSED_POSITION, ORDER, TRANSACTION are documented); needs a real export before implementing D-IFI support.
- Whether Trading 212 `Result` is computed with average cost (believed, not confirmed). It is irrelevant if we ignore it, but useful for reconciliation messages.
- Precise semantics of Trading 212 `Currency conversion` rows (`Total` vs `Currency conversion from/to amount`) in multi-currency accounts; no real sample row was found.
- Whether IBKR `CashTransaction@actionID` reliably links a dividend to its Withholding Tax row in current Flex output (would replace ib-edavki's heuristic matching).
- How IBKR represented the IBCE→IBIE (2024) and IBUK→IBCE (2021) position migrations in Flex (Transfers type INTERNAL vs re-booked trades), and whether original acquisition dates are preserved; needs a real migrated-account export.
- Correct Slovenian date for US extended-hours trades executed after 00:00 Ljubljana time (exchange trade date vs local calendar date). This is a tax-rule question to confirm with FURS guidance.
- Tax classification of Revolut RETURN OF CAPITAL, POSITION CLOSURE (warrants), BOND COUPON and REWARD rows, and of T212 `Dividend (Tax exempted)`/`Stock distribution`/`Spin off` events (out of scope here; parsers should block until classified).

## Sources

- [IBKR Reporting Guide - Trades (Activity Flex Query)](https://www.ibkrguides.com/reportingreference/reportguide/tradesfq.htm)
- [IBKR Reporting Guide - Cash Transactions (Flex)](https://www.ibkrguides.com/reportingreference/reportguide/cash%20transactionsfq.htm)
- [IBKR Reporting Guide - Corporate Actions (Flex) type codes](https://www.ibkrguides.com/reportingreference/reportguide/corporate%20actionsfq.htm)
- [IBKR Reporting Guide - Codes](https://www.ibkrguides.com/reportingreference/reportguide/codes_flex.htm)
- [IBKR Reporting Guide - Transfers (ACATS, Internal)](https://www.ibkrguides.com/reportingreference/reportguide/transfersfq.htm)
- [IBKR Reporting Guide - Financial Instrument Information](https://www.ibkrguides.com/reportingreference/reportguide/financialinstrumentinformationfq.htm)
- [IBKR Client Portal - Create an Activity Flex Query](https://www.ibkrguides.com/clientportal/performanceandstatements/activityflex.htm)
- [IBKR Client Portal - Flex Web Service (v3, 365-day override)](https://www.ibkrguides.com/clientportal/performanceandstatements/flex3.htm)
- [IBKR Client Portal - Transaction History](https://www.ibkrguides.com/clientportal/transaction-history.htm)
- [IBKR sample Activity Statement (Eastern Time note)](https://www.interactivebrokers.co.uk/images/common/Statements/sample_default_broker_client_monthly.html)
- [csingley/ibflex (enums, parser date formats, Types)](https://github.com/csingley/ibflex)
- [jamsix/ib-edavki (Slovenian IBKR->eDavki tool) and issues #121 #136 #138 #160 #167 #171 #177 #181 #205 #213](https://github.com/jamsix/ib-edavki)
- [Portfolio Performance IBFlexStatementExtractor](https://github.com/portfolio-performance/portfolio)
- [UnholyPhoenix/ibkr2dohkdvp](https://github.com/UnholyPhoenix/ibkr2dohkdvp)
- [Trading 212 Help Centre - Can I export the trading data from my account?](https://helpcentre.trading212.com/hc/en-us/articles/360016898917-Can-I-export-the-trading-data-from-my-account)
- [Trading 212 Help Centre - What documents can I get from Trading 212?](https://helpcentre.trading212.com/hc/en-us/articles/11700508002845-What-documents-can-I-get-from-Trading-212)
- [Trading 212 Help Centre - How to export the trading data from my CFD account?](https://helpcentre.trading212.com/hc/en-us/articles/36243765206301-How-to-export-the-trading-data-from-my-CFD-account)
- [Trading 212 Community - New feature: Export your investing history (max 1 calendar year)](https://community.trading212.com/t/new-feature-export-your-investing-history/35612)
- [Trading 212 Public API - Request a CSV report](https://docs.trading212.com/api/historical-events/requestreport)
- [cgt-calc Trading 212 / Revolut / IBKR broker docs and parsers](https://github.com/cgt-calc/capital-gains-calculator)
- [cgt-calc issue #709 (real 2025 T212 header and dividend row)](https://github.com/cgt-calc/capital-gains-calculator/issues/709)
- [cgt-calc issue #1203 (T212 dividends net of WHT, exchange-rate direction)](https://github.com/cgt-calc/capital-gains-calculator/issues/1203)
- [coffee-cpu/capital-gains-uk-101 PR #73 (T212 'Time (UTC)' header, GBX)](https://github.com/coffee-cpu/capital-gains-uk-101/pull/73)
- [titov-vv/jal Trading212 importer](https://github.com/titov-vv/jal)
- [Neophytez/t212-edavki](https://github.com/Neophytez/t212-edavki)
- [zvranesic/t212-edavki](https://github.com/zvranesic/t212-edavki)
- [dickwolff/Export-To-Ghostfolio sample exports](https://github.com/dickwolff/Export-To-Ghostfolio)
- [Revolut Help - Why is Revolut Trading Ltd migrating EEA customers to its European trading entity](https://help.revolut.com/en-LT/help/wealth/stocks/migration-to-eea-trading-entity/why-is-revolut-trading-ltd-migrating-eea-resident-stock-trading-customers-to-its-european/)
- [Revolut Help - Trading account statements and reports](https://help.revolut.com/help/wealth/stocks/getting-started-with-trading/managing-your-trading-account/trading-statements/accessing-my-trading-statements-and-reports/)
- [Revolut news - European listed stocks added across the EEA](https://www.revolut.com/en-ES/news/revolut_adds_european_listed_stocks_to_its_trading_platform_across_the_eea/)
- [ulyssetsd/revoprofit (Revolut CSV samples 2021/2022/2025)](https://github.com/ulyssetsd/revoprofit)
- [RustInFinance/etradeTaxReturnHelper (Revolut P&L and consolidated parsers)](https://github.com/RustInFinance/etradeTaxReturnHelper)
- [webamMarko/revolut-edavki-converter (real-looking Revolut stock and CFD exports)](https://github.com/webamMarko/revolut-edavki-converter)
- [JakaCikac/revolut-edavki](https://github.com/JakaCikac/revolut-edavki)
- [jsitla/Revolut-tax-investing-account](https://github.com/jsitla/Revolut-tax-investing-account)
- [GeiserX/DeclaRenta (Revolut XLSX parser; issue #56)](https://github.com/GeiserX/DeclaRenta)
- [doino-gretchenliev/revolut-stocks (legacy Revolut PDF activity codes)](https://github.com/doino-gretchenliev/revolut-stocks)
