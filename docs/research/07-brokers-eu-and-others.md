# Broker export formats: eToro, Trade Republic, XTB, DEGIRO and other brokers used in Slovenia

> Researched: 2026-10-07 · Verification: not independently verified
>
> Research for building TaxReporter. It is not tax advice, and FURS publications and the law win over anything written here. Where this page overlaps a verified doc (01–03), the verified doc wins; such places are cross-referenced inline. See the [README](README.md#confidence-and-verification-legend) for the legend.

**Scope.** Brokers used by Slovenian investors, excluding IBKR, Trading 212 and Revolut, which are covered in [06](06-brokers-ibkr-t212-revolut.md). Tax years in scope: 2025 (filed by 2 March 2026) and 2026 (filing season Jan–Feb 2027).

**Confidence notation:** **[H]** means confirmed in a primary source (official help center, legislation, or the source code of a parser that reads real exports). **[M]** means seen in two or more independent secondary sources or in fixtures of a maintained parser. **[L]** means a single secondary source or an inference, so check it against a real export before relying on it.

---

## 1. Summary

- **Implementation order (ranked by Slovenian usage evidence; §2):** eToro → Trade Republic → XTB → DEGIRO → Lightyear → Freedom24 → Saxo → Bitpanda. Then N26 (PDF-only), followed by Scalable, BUX and flatex, which are effectively unavailable to Slovenian residents.
- **CFDs must be separated from real positions.** eToro and XTB both mix them. CFD and other derivative rows go to **D-IFI**, not Doh-KDVP. Bitpanda's legacy "Stock (derivative)" / "ETF (derivative)" assets are derivative contracts, not shares [H].
- **Recompute EUR yourself.** Most brokers give native-currency price and quantity plus their own EUR (or USD) conversion. Recompute EUR with the Banka Slovenije rate ([03](03-bsi-exchange-rates.md)). Use the broker's converted columns only as a cross-check.
- **Corporate actions.** Several brokers (DEGIRO, Trade Republic `MIGRATION`, Saxo) record splits, ISIN changes and migrations as a sell followed by a buy. These must not become taxable disposals.
- **Domestic brokers need no parser for capital gains.** Slovenian legal persons, and non-residents with a Slovenian branch, that transfer securities must send every acquisition and disposal to FURS by **31 January** (ZDavP-2 Art. 339(3)) [H]. They use the KP_KDVP / KP_IFI XML schemas, and FURS uses that data to pre-fill the taxpayer's Doh-KDVP / D-IFI [H].
- **New in 2025/2026:**
  - Individual investment accounts (INR, under the ZINR act) have existed since **5 March 2026**. Securities held in an INR are not reported per trade and are taxed at withdrawal by the provider [H].
  - The data-delivery regulation was amended twice: Ur. l. 107/2025 (applies to tax year 2025) and Ur. l. 1409/2026 of 9 Sep 2026 (applies to tax year 2026) [H].
  - Trade Republic added a native CSV transaction export in **April 2026** [M].
  - eToro's statement headers changed at least four times between 2024 and Nov 2025 [H, parser source].
  - Bitpanda's derivative stocks became **sell-only "Legacy assets"**, and Bitpanda now offers real securities [H].

---

## 2. Popularity ranking and evidence

There are no official statistics by broker; FURS does not publish Doh-KDVP counts by broker. The ranking therefore combines several proxies, all observed on 2026-10-07:

| Rank | Broker | Evidence | Best tax export | Parser effort |
|---|---|---|---|---|
| 1 | **eToro** | `masbug/etoro-edavki` has 62 ★, second only to `ib-edavki` (316 ★) among Slovenian eDavki converters on GitHub; it was updated Nov 2025 and Feb 2026 for new statement formats. The slo-tech thread "Etoro in Edavki" (t760618) has about 200 posts (2020–2025). Both Slovenian commercial converters support eToro (daveknadobicek.si, edavki.rešitve.si), and money-how.si (Feb 2026) discusses eToro. | Account Statement **XLSX** | High: multiple header versions, CFD split, USD base |
| 2 | **Trade Republic** | Launched in Slovenia in Oct 2022. The slo-tech thread "TradeRepublic" (t825085) has about **1,950 posts**; its latest post on the last page is dated 27 Sep 2026. Žurnal24 has published how-to-file articles on TR interest (2025) and dividends (2026). Supported by both commercial converters. | Native **CSV** (Apr 2026) | Medium |
| 3 | **XTB** | BrokerChooser's 2026 Slovenia ranking puts XTB #4 (after IBKR, MEXEM and T212). No Slovenian open-source converter exists, which is a gap. | Web **XLSX** "Account History" | Medium–High |
| 4 | **DEGIRO** | The slo-tech thread "Degiro online broker…" (t718019) has about 500 posts and was active in 2026. `rmilosic/edavki-xml-converter` converts DEGIRO dividends to Doh-Div. Supported by daveknadobicek.si. | **Transactions.csv + Account.csv** | Medium–High: language variants |
| 5 | **Lightyear** | Officially available to Slovenian residents. Few Slovenia-specific signals. | Transaction report **CSV** | Low–Medium |
| 6 | **Freedom24** | Available in Slovenia [M]; supported by edavki.rešitve.si. | Broker report **JSON** | Medium |
| 7 | **Saxo** | Supported by edavki.rešitve.si. | Transactions **XLSX** | Medium |
| 8 | **Bitpanda** | Mainly used for crypto; stocks are legacy derivatives. | History **CSV** | Medium (tax classification) |
| 9 | N26 (Upvest) | Stocks/ETFs available in Slovenia [H]; daveknadobicek.si supports it. Exports are PDF only. | PDF order confirmations | Out of scope for deterministic CSV parsing |
| — | Scalable, BUX, flatex | Scalable accepts only residents of DE, AT, IT, ES, FR and NL. BUX serves AT, BE, FR, DE, IE, IT, NL and ES. flatex is DACH-focused. | — | Only for people who moved to Slovenia |

---

## 3. Cross-cutting parser rules

1. **Detect columns by header text, never by position.**
   - DEGIRO uses *empty* header cells for currency columns (`Price,,Local value,,`).
   - eToro, DEGIRO, XTB and Freedom24 localize headers or values to the UI language.
   - XTB sheets have banner rows above the header: on the closed-positions sheet the header is on row 13.
2. **Accept both number locales.**
   - eToro EN uses `1,071.56` with dot decimals.
   - DEGIRO with an NL/PT/ES UI uses quoted values with a comma decimal (`"-290,00"`).
   - Scalable uses `98,5`.
   - Saxo mixes the two: price inside `Event` uses a dot, while `Amount` may be `"419,22"`.
3. **Date formats.**

   | Broker | Format |
   |---|---|
   | eToro | `DD/MM/YYYY HH:MM:SS`, or `DD.MM.YYYY HH:MM:SS` together with decimal commas |
   | DEGIRO | `DD-MM-YYYY` with a separate `HH:MM` time column |
   | XTB | Excel serial numbers in XLSX (e.g. `45716.648060671301`); `DD.MM.YYYY HH:MM:SS` in CSV/text |
   | Lightyear | `DD/MM/YYYY HH:MM:SS` |
   | Trade Republic | ISO-8601 UTC `datetime` plus a local `date` |
   | Bitpanda | ISO-8601 with offset |
   | Freedom24 | `YYYY-MM-DD HH:MM:SS` |
   | Saxo | `DD-Mon-YYYY` |

   Use the local trade **date**, not the UTC date, for the BSI rate lookup.
4. **Route by asset class.**
   - Real share/ETF/fund → Doh-KDVP.
   - CFD or other derivative → D-IFI.
   - Crypto → excluded from both. The 25% crypto-gains bill (ZDDKS) was withdrawn from the December 2025 parliamentary agenda, so it is not law for 2026 [M].
   - The derivatives-gains act (ZDDOIFI) was amended in Oct 2025 to a flat 25% regardless of holding period [M]. The effective date is confirmed in [04 §2.4](04-si-tax-rules.md#24-contrast-derivatives-under-zddoifi-filed-on-doh-ifi-not-doh-kdvp) (verified): ZDDOIFI-B (UL 85/2025) applies the flat 25% to tax years from 1 Jan 2026, and deletes the holding-period scale and the 20-year exemption.
5. **Dividends.**
   - Doh-Div needs gross amount, foreign tax, payer identification and source country. No broker export contains the payer's address or tax number, so the app needs an enrichment table keyed by ISIN (as `masbug/etoro-edavki` does with `Company_info.xlsx`).
   - Several brokers emit one dividend row per position or partial lot (eToro per Position ID, XTB per lot). Aggregate them per payer and per day. **Sources conflict here:** FURS requires one `Dividend` record per payment on the evidence and has rejected a return that summed two same-day payments ([02 §5](02-furs-doh-div-and-others.md#5-one-record-per-payment-and-payer-ids), verified). Whether per-position fragments of one corporate payment may be merged is not settled by any source, so treat this aggregation as an open question, not a rule.
6. **Fees.** Commission, FX/AutoFX, spread, SDRT/FTT/TOB and overnight fees appear in different columns or as separate cash rows. Keep them typed so the tax engine can apply the cost policy.
7. **Full history.** FIFO needs every acquisition, so ask for an export "since account opening". eToro additionally needs Account Activity rows to map Position ID → ticker (`masbug` aborts if the mapping is missing).

---

## 4. Per-broker reference

### 4.1 eToro

**Export path.** Portfolio → History (clock icon) → settings cog → *Account statement* → choose start/end date → XLS icon [H, `masbug` README]. In 2021 eToro moved it under Settings → Account → "View" next to Account Statement, with presets such as "Last Year" [M].

**Workbook.** Formats are PDF and XLS(X). The XLSX has five sheets: `Account Summary`, `Closed Positions`, `Account Activity` (formerly "Transactions Report"), `Dividends` and `Financial Summary` [M].

- Sheet names and headers are translated with the UI language. The Spanish export uses `Posiciones cerradas`, `Actividad de la cuenta` and `Dividendos`, with headers such as `Acción`, `Ganancias (EUR)` and `Tipo de cambio de apertura (USD)` [M].
- Use the **XLSX**; the PDF is for humans.

**`Closed Positions` header history** (verbatim from `masbug/etoro-edavki`, versions dated by the maintainer) [H]:

| Version | Columns |
|---|---|
| 2024 | `Position ID, Action, Amount, Units, Open Date, Close Date, Leverage, Spread Fees (USD), Profit(USD), Profit(EUR), Open Rate, Close Rate, Take profit rate, Stop lose rate, Rollover Fees and Dividends, Copied From, Type, ISIN, Notes` |
| 2024.7 | adds `Long / Short`, `Market Spread (USD)`; `Rollover…` → `Overnight Fees and Dividends` |
| 2024.8 | adds `FX rate at open (USD)`, `FX rate at close (USD)` before `Open Rate` |
| 2025.1 | `Stop lose rate` → `Stop loss rate`; **ISIN removed** |
| 2025.2 | `Units` → `Units / Contracts` |
| 2025.2.15 (current) | `Position ID, Action, Long / Short, Amount, Units / Contracts, Open Date, Close Date, Leverage, Spread Fees (USD), Market Spread (USD), Profit(USD), Profit(EUR), FX rate at open (USD), FX rate at close (USD), Open Rate, Close Rate, Take profit rate, Stop loss rate, Overnight Fees and Dividends, Copied From, Type, ISIN, Notes` (**ISIN restored**) |

**`Account Activity`** [H]:

| Version | Columns |
|---|---|
| 2022 | `Date, Type, Details, Amount, Realized Equity Change, Realized Equity, Balance, Position ID, NWA` |
| 2023 | adds `Units` and `Asset type` |
| 2025.2 | `Date, Type, Details, Amount, Units / Contracts, Realized Equity Change, Realized Equity, Balance, Position ID, Asset type, NWA` |

**`Dividends`** [H]:

| Version | Columns |
|---|---|
| 2024 | `Date of Payment, Instrument Name, Net Dividend Received (USD), Net Dividend Received (EUR), Withholding Tax Rate (%), Withholding Tax Amount (USD), Withholding Tax Amount (EUR), Position ID, Type, ISIN` |
| 2025.1 | ISIN removed |
| 2025.11 | `Date of Payment, Instrument Name, Net Dividend Received (USD), Net dividends, Currency, Franked/Unfranked, Franking Credits (AUD), Net Dividend Received (EUR), Withholding Tax Rate (%), Withholding Tax Amount (USD), Withholding Tax Amount (EUR), Position ID, Type, ISIN` |

**Values and enumerations:**

- `Action` = `"Buy <instrument name>"` / `"Sell <instrument name>"`. The ticker comes from Account Activity `Details` = `"AAPL/USD"` (ticker/quote currency), joined on `Position ID`.
- `Long / Short` ∈ {`Long`, `Short`}.
- `Type` (closed positions) seen: `Stocks`, `ETF`, `Crypto`, `CFD`. The `masbug` derivative list also contains `OPT`, `FUT`, `FOP` and `Crypto Margin`. Commodity, currency and index rows are always CFDs.
- Account Activity `Type` seen: `Open Position`, `Position closed`, `Dividend`, `Overnight fee`, `Overnight refund`, `Interest Payment`, `SDRT`, `Withdraw Request`, `Withdraw Fee`, `Withdrawal Conversion Fee` [M].
- `"-"` marks N/A, including the FX columns for USD-quoted instruments.
- Withholding rate is written like `15%`.

**CFD vs real.** A row is a derivative (→ D-IFI) when any of these holds:

- `Type` is one of the derivative types above;
- `Leverage > 1`;
- `Long / Short` = `Short` (in the EU a real asset is only a long, 1× position) [M].

`masbug` rejects rows with leverage > 1 whose type is a real-asset type. For leveraged CFDs, `Amount` is the margin; the notional is `Amount × Leverage`.

**Currency.**

- `Amount`, `Profit(USD)`, spread and fee columns are in USD (the account base).
- `Open Rate` / `Close Rate` are in the **instrument's** currency. `FX rate at open/close (USD)` converts that currency to USD.
- For EUR- or GBP-quoted instruments, convert the native price with the BSI rate for that currency. For EUR instruments no conversion is needed. Avoid `masbug`'s detour (native → USD via eToro's rate → EUR via BSI), which adds error.
- Since Oct 2024 EU users can fund trades from a EUR balance [H, press release]. The 2025.11 `Net dividends` + `Currency` columns are the native-currency amounts.

**Dividends.**

- There is no gross column: gross = net + WHT.
- Rows are per position, so aggregate them (but see the conflict noted in §3, rule 5).
- ISIN is absent from statements exported between roughly Jan and Feb 2025.

**Pitfalls:**

- Five header revisions in 18 months; `masbug` fixes its parser almost every season.
- Partial closes and copy-trading positions (`Copied From`).
- Crypto rows (exclude).
- `Open Date` must come from full history.
- The statement time zone is not documented [L].

**Synthetic sample (`Closed Positions`, TSV view of the sheet):**

```text
Position ID	Action	Long / Short	Amount	Units / Contracts	Open Date	Close Date	Leverage	Spread Fees (USD)	Market Spread (USD)	Profit(USD)	Profit(EUR)	FX rate at open (USD)	FX rate at close (USD)	Open Rate	Close Rate	Take profit rate	Stop loss rate	Overnight Fees and Dividends	Copied From	Type	ISIN	Notes
3000000001	Buy Apple	Long	500.00	2.631579	03/02/2026 15:31:07	14/07/2026 16:02:44	1	0.00	0.66	71.05	60.42	1	1	190.00	217.00	0.00	0.00	0.00		Stocks	US0378331005	
3000000003	Sell Tesla	Short	200.00	0.800000	05/05/2026 14:00:00	06/05/2026 18:00:00	1	0.00	0.30	12.00	10.25	1	1	250.00	235.00	0.00	500.00	-0.05		CFD	US88160R1014	
3000000004	Buy NVIDIA	Long	100.00	2.000000	02/06/2026 15:45:00	09/06/2026 15:45:00	5	0.00	0.10	15.00	12.80	1	1	250.00	257.50	0.00	0.00	-0.40		CFD	US67066G1040	
```

### 4.2 Trade Republic

**Availability and history.** Available in Slovenia since the Oct 2022 expansion [M]. Until 2026 TR offered only PDFs: per-transaction confirmations and an annual "Tax report" (Profile → Tax Reports) that Slovenian users attach to FURS filings [M]. Money-how.si (Feb 2026) still describes TR as PDF-only.

**CSV export (April 2026)** [M]: Profile → Account statements → **Transaction export** → *All transactions* or a period → Create → Download. It is reported to be app-only. One file covers the securities account, the cash account and crypto. `GhostfolioSidekick` added its parser on 2026-04-17.

**Header (23 columns, every field quoted)** [M]:

```text
"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"
```

**Enumerations seen in parser fixtures** [M]:

- `account_type`: `DEFAULT`.
- `category`: `TRADING`, `CASH`, `CORPORATE_ACTION`, `DELIVERY`.
- `type`:
  - trading: `BUY`, `SELL`, `SAVINGS_PLAN_EXECUTED`
  - income: `DIVIDEND`, `INTEREST_PAYMENT`
  - rewards: `BENEFITS_SAVEBACK`, `STOCKPERK`, `BONUS`
  - card: `CARD_TRANSACTION`, `CARD_TRANSACTION_INTERNATIONAL`
  - transfers: `CUSTOMER_INBOUND`, `CUSTOMER_INPAYMENT`, `CUSTOMER_OUTBOUND_REQUEST`, `TRANSFER_INSTANT_INBOUND`, `TRANSFER_INSTANT_OUTBOUND`
  - corporate actions and other: `REDEMPTION`, `FINAL_MATURITY`, `MIGRATION`, `PRIVATE_MARKET_BUY`
- `asset_class`: `STOCK`, `FUND`, `BOND`, `PRIVATE_FUND` (crypto likely, not yet seen).
- `symbol` holds the **ISIN**.

**Formats.**

- Dot decimals; `shares` has 10 decimal places (fractional savings plans); sells carry negative `shares`.
- `amount` is the signed cash flow and `fee` is negative.
- `datetime` is UTC (`…Z`) while `date` is the local Berlin date: `2024-02-14T23:19:02Z` belongs to `2024-02-15`.

**Pitfalls:**

- `MIGRATION` comes as a −n/+n pair; it is not a disposal.
- Saveback and stockperk acquisitions are free shares. Their cost basis is a tax question.
- The exact meaning of `amount`/`tax`/`original_amount` on dividends is unconfirmed [L]. Parsers treat `amount` as gross EUR and `tax` as withholding. Verify against TR's dividend PDF.
- Filter out card and transfer noise by `category`.

**Synthetic sample:**

```text
"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"
"2026-01-20T08:15:02.120Z","2026-01-20","DEFAULT","TRADING","BUY","FUND","Core MSCI World USD (Acc)","IE00B4L5Y983","4.0000000000","98.500000","-394.00","-1.00","","EUR","","","","","00000000-0000-4000-8000-000000000001","","","",""
"2026-05-15T09:18:54.920906Z","2026-05-15","DEFAULT","CASH","DIVIDEND","STOCK","Apple","US0378331005","0.2702700000","","0.060000","","-0.01","EUR","0.07","USD","1.160000","","00000000-0000-4000-8000-000000000003","","","",""
"2026-07-14T22:40:55.000Z","2026-07-15","DEFAULT","TRADING","SELL","STOCK","Apple","US0378331005","-0.2702700000","186.400000","49.38","-1.00","","EUR","","","","","00000000-0000-4000-8000-000000000004","","","",""
```

### 4.3 XTB

**Export** [H, XTB help center, updated 2026-07-31]:

- Web: *Account History* tab → closed positions, cash operations, orders → download in **Excel** format.
- Mobile: Profile → Transaction History → arrow icon → *New Report* → date range → account → *Generate Report* → *Report History*.

**XLSX structure** (real export, Mar 2025) [H]. Some sheets start at column B; header row positions shift with the banner.

| Sheet | Header row | Columns |
|---|---|---|
| `CLOSED POSITION HISTORY` | 13 | `Position, Symbol, Type, Volume, Open time, Open price, Close time, Close price, Open origin, Close origin, Purchase value, Sale value, SL, TP, Margin, Commission, Swap, Rollover, Gross P/L, Comment` |
| `OPEN POSITION <DDMMYYYY>` | 11 | `Position, Symbol, Type, Volume, Open time, Open price, Market price, Purchase value, SL, TP, Margin, Commission, Swap, Rollover, Gross P/L, Comment` |
| `PENDING ORDERS HISTORY ` (note the trailing space) | 11 | `ID, Symbol, Purchase value, Nominal Value, Price, Margin, Type, Order, side, SL, TP, Open time` |
| `CASH OPERATION HISTORY` | 11 | `ID, Type, Time, Comment, Symbol, Amount` |
| MT4/MT5 accounts only: `CLOSED POSITION HISTORY MT`, `BALANCE OPERATION HISTORY MT` | — | — |

**Older CSV export.** The cash-operations column order is `ID;Type;Time;Symbol;Comment;Amount` (semicolon; Symbol *before* Comment) [M].

**Values:**

- Closed-position `Type` ∈ {`BUY`, `SELL`}.
- Times are Excel serials in XLSX and `DD.MM.YYYY HH:MM:SS` in CSV.
- `Open price`/`Close price` are in the instrument currency; `Purchase value`, `Sale value`, `Gross P/L` and all cash amounts are in the **account currency** (normally EUR for Slovenian clients) [M].

**Cash-operation `Type` values** (the spelling varies by period and language) [M]:

- Purchases/sales: `Stocks/ETF purchase` / `Stocks/ETF sale` (older: `Stock purchase` / `Stock sale`).
- Dividends: `DIVIDENT` (sic) or `Dividend`.
- Withholding: `Withholding Tax` or `Withholding tax`.
- Interest: `Free-funds Interest` / `Free funds interests`, and `Free-funds Interest Tax` / `Free funds interests tax`.
- Other: `SEC fee`, `close trade`, `Profit/Loss (FX/CFD)`, `swap` / `Swap`, `tax IFTT`, `Spin off`, `Transfer`, `deposit`, `withdrawal`, `Inactivity Fee`.
- Localized UIs translate the types too, for example Portuguese `Ações/ETF compra` / `Ações/ETF vende`.

**`Comment` formats:**

- Trades: `OPEN BUY 3 @ 190.00`, `CLOSE BUY 3 @ 217.00`.
- Partial fill of a fractional order: `OPEN BUY 34/42.5658 @ 11.7480`.
- Dividend: `AAPL.US USD 0.2600/ SHR`.
- Withholding: `AAPL.US USD WHT 15%`.
- Interest: `Free-funds Interest 2026-07`.
- Corrections start with `Corr `.

**CFD vs real.** Real stocks and ETFs have exchange-suffixed symbols (`.US`, `.DE`, `.UK`, `.PL`, `.FR`, `.NL`…), `Margin = 0` and non-zero `Purchase value`. CFDs (`US500`, `EURUSD`, `GOLD`, `OIL`…) have `Margin > 0` and empty or zero purchase/sale value, and their P/L appears as `close trade` / `Profit/Loss (FX/CFD)` cash rows [M]. Route CFDs to D-IFI.

**Pitfalls:**

- Dividends and WHT can be split into several rows for the same symbol and time.
- WHT can be **positive** (reversal).
- Interest corrections arrive as separate rows.
- Every `Stocks/ETF purchase/sale` cash row duplicates a position row; use positions for trades and cash ops only for income and fees.
- Fractional volumes.

**Synthetic sample (`CASH OPERATION HISTORY`):**

```text
ID	Type	Time	Comment	Symbol	Amount
900000002	DIVIDENT	15.05.2026 10:02:11	AAPL.US USD 0.2600/ SHR	AAPL.US	0.67
900000003	Withholding Tax	15.05.2026 10:02:11	AAPL.US USD WHT 15%	AAPL.US	-0.10
900000004	Stocks/ETF sale	14.07.2026 15:40:55	CLOSE BUY 3 @ 217.00	AAPL.US	556.47
```

### 4.4 DEGIRO (flatexDEGIRO)

**Availability.** Slovenian residents are accepted through a non-Slovenian entity; there is no Slovenian site [L].

**Exports** [M]:

- Inbox → **Transactions** (CSV / Excel / PDF).
- Inbox → **Account statement** (CSV / Excel / PDF).
- Portfolio → Export.
- *Annual report* (PDF only).
- Trades come only from Transactions; dividends, WHT, FTT/TOB, ADR fees and interest come only from Account. **Both files are required.**

**`Transactions.csv`**:

| Variant | Header |
|---|---|
| Current EN (2023+) [M] | `Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,` (note the trailing comma) |
| Spanish equivalent | `Fecha,Hora,Producto,ISIN,Bolsa de referencia,Centro de ejecución,Número,Precio,,Valor local,,Valor EUR,Tipo de cambio,Comisión AutoFX,Costes de transacción y/o externos EUR,Total EUR,ID Orden,` |
| Legacy 19-column (NL) | `Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde,,Wisselkoers,Transactiekosten en/of kosten van derden,,Totaal,,Order ID` (currency in a blank-header column after each amount) |

In recent files the order UUID often sits in the **unnamed trailing column**, leaving `Order ID` empty [M]. Detect UUIDs instead of trusting the header.

**`Account.csv`** [M]:

- EN: `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id`
- NL: `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id`
- PT: `Data,Hora,Data Valor,Produto,ISIN,Descrição,T.,Mudança,,Saldo,,ID da Ordem`
- ES: `Fecha,Hora,Fecha valor,Producto,ISIN,Descripción,Tipo,Variación,,Saldo,,ID Orden`
- German headers were not verified.

**`Description` values (EN):**

- Trades: `Buy 4 CONSTELLATION ENERGY CORP@244 USD (US21037T1097)`, `Sell …`.
- Dividends: `Dividend`, `Dividend Tax`, `Fund Distribution`.
- FX legs: `FX Credit`, `FX Debit`.
- Fees: `DEGIRO Transaction and/or third party fees`, `DEGIRO Exchange Connection Fee 2026 (Nasdaq - NDQ)`.
- Cash: `Flatex Interest Income`, `Degiro Cash Sweep Transfer`, `Money Market fund conversion: Buy 0.5 at 1 GBP`.
- Translated equivalents: NL `Koop`/`Verkoop`/`Dividendbelasting`, PT `Compra`/`Venda`, ES `Dividendo`/`Retención del dividendo`.

**FX convention.** `Exchange rate` = foreign units per 1 EUR, so `Value EUR = Local value / Exchange rate`. Example: −976.00 USD / 1.1564 = −844.00 EUR. This is the same quoting convention as BSI/ECB, but it is DEGIRO's dealing rate, so recompute with BSI.

**Pitfalls:**

- One order is split into several rows with the same Order ID, and the fee sits on one row only.
- ISIN changes, splits and share swaps appear as **orderless, cost-free sell + buy pairs** in Transactions [M]. Treat them as non-taxable continuations (keep the original cost and date) unless the event is a taxable exchange.
- Delimiter (comma or semicolon) and decimal format follow the UI locale.
- GBX prices.

### 4.5 Lightyear

**Availability.** Officially available to Slovenian residents [H].

**Statements** [H] (PDF; mobile: Transactions → Statements; web: profile → Settings → Account):

- *Account*.
- *Income*: in the entity currency, with end-of-day FX.
- *Capital gains*: FIFO or Average cost. Pick **FIFO** for Slovenia.
- *Cost & charges* (ex-post).

**CSV "Transaction report"** (app or web Activities → download/export CSV) [M]:

```text
Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.
```

**Values:**

- `Type` ∈ {`Buy`, `Sell`, `Dividend`, `Distribution`, `Interest`, `Reward`, `Conversion`, `Deposit`, `Withdrawal`}.
- Reference prefixes: `OR-` (order), `DD-` (dividend), `IN-` (interest/distribution), `CN-` (conversion), `DT-` (deposit), `WL-` (withdrawal), `RW-` (reward).
- Dates `DD/MM/YYYY HH:MM:SS`; quantity has 9 decimal places.
- FX conversions appear as two `Conversion` rows (one per currency) with the fee on the EUR leg.

**Dividends.** Gross = `Gross Amount` and WHT = `Tax Amt.`. Lightyear files W-8BEN automatically, so Slovenian residents get **15%** US withholding [H]. For EU/UK instruments, non-treaty rates are withheld (e.g. FR 25%, BE 30%, DK 27%) and treaty relief is not applied [H].

**Pitfall.** Money-market "Savings" funds (e.g. `BRICEKSP`, `ICSUSSDP`) produce `Distribution` rows and frequent buy/sell churn.

### 4.6 Freedom24 (Freedom Finance Europe)

**Export.** Client area → Reports → **Broker report** → period → PDF / XLS(X) / **JSON** / XML [M]. The JSON comes from the same Tradernet back end as other Freedom entities [H, real fixture], so prefer JSON.

**JSON structure** [H]:

- Top level: `report.{date_start, date_end, plainAccountInfoData{client_code, base_currency, …}, trades{detailed[], securities, total}, corporate_actions{detailed[], total}, cash_flows{detailed[], total}, commissions, securities_in_outs, cash_in_outs, account_at_start, account_at_end, …}`.
- `trades.detailed[]`: `trade_id, date ("YYYY-MM-DD HH:MM:SS"), short_date, pay_d (settlement), instr_nm (e.g. AAPL.US), instr_type, instr_kind, issue_nb, isin, operation (buy|sell), p, curr_c, q, summ, profit, fifo_profit, commission, commission_currency, mkt_name, order_id, broker ("FFEU"), id ("trade/order")`.
- `corporate_actions.detailed[]`: `date, type (localized, e.g. "Дивиденды"), type_id (dividend|dividend_compensation|…), amount, amount_per_one, ticker, isin, currency, ex_date, external_tax, external_tax_currency, tax_amount (negative or "-"), tax_currency, comment, q_on_ex_date`. A Polish tax tool also handles `type` ∈ {`Dividends`, `Conversion`, `Split`}.
- `cash_flows.detailed[]`: `date, account, sum ("-0.47 USD"), amount, currency, type (localized), type_id (tax|…), comment`.

**Pitfalls:**

- Branch on `type_id`, never on the localized `type`.
- `commission_currency` can differ from `curr_c`.
- `dividend_compensation` rows are short or repo positions paying the dividend.
- Withholding appears both in `tax_amount` and as a `cash_flows` `tax` row, so do not double count.

### 4.7 Saxo

**Export.** Profile → *Transaction overview* → Export → **Excel** (single sheet; "Transaktioner" for Danish users) [M].

**Columns** (variant A, the Transactions export) [M]:

```text
Client ID,Trade Date,Value Date,Type,Instrument,Instrument ISIN,Instrument currency,Exchange Description,Instrument Symbol,Event,Amount,Order ID,Conversion Rate
```

**Values:**

- `Type` ∈ {`Trade`, `Corporate action`, `Cash amount`, …}.
- `Event` examples: `Buy 3 @ 190.00 USD` / `Sell …` (Danish `Købt` / `Solgt`), `Dividend` / `Cash dividend`, `Custody Fee`.
- `Instrument Symbol` looks like `AAPL:xnas`.
- `Amount` is in the account currency; `Conversion Rate` converts instrument currency to account currency.
- Dates look like `03-Feb-2026`.

**Variant B** (another Saxo export) uses `Transaction Type`, `Booked Amount`, `Total cost` and `Currency` [L].

**Pitfall.** Split rows carry no share count. How withholding is presented for dividends is unverified [L].

### 4.8 Bitpanda

**Export.** User icon/Profile → History → Export → CSV or PDF, or Reports and Statements → Transaction history [H]. Dedicated tax reports exist for Austria only [H].

**CSV layout.**

- About 6 preamble lines: disclaimer; name, DOB; e-mail; `Account opened at: …`; `Venue: Bitpanda`; `Reported by Bitpanda GmbH`.
- Then the header [M]:

  ```text
  Transaction ID,Timestamp,Transaction Type,In/Out,Amount Fiat,Fiat,Amount Asset,Asset,Asset market price,Asset market price currency,Asset class,Product ID,Fee,Fee asset,Spread,Spread Currency,Tax Fiat
  ```

- `Tax Fiat` is newer; 2022 files have 16 columns.
- Legacy v1 header: `ID,Type,In/Out,Amount Fiat,Fee,Fiat,Amount Asset,Asset,Status,Created at`.

**Values:**

- `Asset class` ∈ {`Fiat`, `Cryptocurrency`, `Stock (derivative)`, `ETF (derivative)`, `Commodity`, `Metal`}.
- `Transaction Type` ∈ {`deposit`, `withdrawal`, `buy`, `sell`, `transfer`, `rewards`, `transfer(stake)`…}.
- `-` means N/A; timestamps are ISO with offset.
- **There is no ISIN.** Map instruments via `Product ID` + `Asset`.
- Rely on `Transaction Type`; the `In/Out` direction is inconsistent across samples [L].

**Tax classification.** Bitpanda states that **Legacy assets (A-Token, derivative contracts)** give exposure without ownership and are now **sell-only**. It also introduced **Real Securities** (real stocks, ETFs and ETCs; €1 per trade; executed on the Quotrix exchange) [H].

- Legacy derivative rows should be treated as derivatives (D-IFI) unless a FURS position says otherwise [L].
- The `Asset class` label used for Real Securities is unconfirmed [L].

### 4.9 N26, Scalable, BUX, flatex

- **N26 Stocks/ETFs** are custodied by Upvest Securities GmbH and available in Slovenia [H]. Documents are limited to ex-ante cost disclosures and order confirmations (PDF), which are not machine-friendly.
- **Scalable** CSV (for movers): `date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency`.
  - `status` ∈ {`Executed`, `Pending`, `Cancelled`}; skip anything not Executed.
  - `type` ∈ {`Buy`, `Sell`, `Savings plan`, `Distribution`, `Interest`, `Deposit`, `Withdrawal`}; `assetType` ∈ {`Security`, `Cash`}.
  - Decimal comma [M].
- **flatex** (DE/AT) uses two `;`-separated files: `Nummer;Buchtag;Valuta;ISIN;Bezeichnung;Nominal;;Buchungsinformationen;TA-Nr.;Kurs;;Depot` and `Buchtag;Valuta;BIC / BLZ;IBAN / Kontonummer;Buchungsinformationen;TA-Nr.;Betrag;;Auftraggeberkonto;Konto` [M].

### 4.10 Domestic Slovenian brokers (Ilirika, NLB, Alta Invest, InterCapital, OTP, BKS…)

- **Who reports, and by when.** ZDavP-2 Art. 339 requires legal persons that are Slovenian residents, or non-residents **with a branch in Slovenia**, who carried out transfers of securities or fund units to deliver acquisition and disposal data to FURS **by 31 January** for the previous year [H].
  - InterCapital operates through "INTERKAPITAL vrijednosni papiri, Podružnica Slovenija" (SI34396594), so it falls under this rule [M].
- **Format.** The data goes in the KP_KDVP.XSD (sets PODVP / PODD / PODINVK / PODVPGB) and KP_IFI.XSD (PODIFI) schemas, submitted asynchronously via EDP.
- **Purpose: pre-filling.** FURS's stated purpose is to reuse the reported data to **pre-fill** the taxpayer's Doh-KDVP / D-IFI [H, FURS Usmeritve 2012]. The taxpayer chooses to pre-fill "from documents received from brokerage houses or banks", then verifies, corrects and signs [M].
  - The app should therefore **not** re-generate these trades. At most it should warn about overlap with imported foreign-broker data.
- **Format changes.** The delivery regulation's Annex 1 was replaced for tax year 2025 (Ur. l. RS 107/2025) and again for tax years from 1 Jan 2026 (Ur. l. RS 1409/2026, dated 3 Sep 2026, published 9 Sep 2026) [H]. The 2026 text states that **INR providers do not report trades held within an INR**.
- **INR (ZINR).** Available since 5 Mar 2026 from NLB, BKS, Ilirika, OTP, Generali Investments and JonatanMars Invest [M]. Gains are taxed at 15% on withdrawal (0% after 15 years) and withheld by the provider; "Davčne napovedi ne oddajate sami" (you do not file a return yourself) [H, NLB].
- **Dividends.** A Slovenian company paying dividends withholds 25% as a final tax, so there is no filing. Dividends paid directly from abroad must be declared by the recipient on Doh-Div by end of February [H, FURS] (28 February, moved to the next working day when it falls on a weekend; see [02 §7](02-furs-doh-div-and-others.md#7-deadlines-and-what-changed), verified). Whether a domestic custodian withholds on *foreign* dividends is not documented in sources found [L]; check the broker's annual statement.

---

## 5. Changes in 2025/2026 that affect broker parsing

| Date | Change | Impact |
|---|---|---|
| Oct 2024 | eToro lets EU users fund trades in EUR | Native-currency columns matter |
| Jan–Feb 2025 | eToro drops then restores ISIN; `Units / Contracts` rename | Header-tolerant parser |
| Nov 2025 | eToro Dividends adds `Net dividends`, `Currency`, franking columns | Header-tolerant parser |
| Oct 2025 | ZDDOIFI amendment (flat 25% derivatives rate) passed by National Assembly [M]; published as ZDDOIFI-B in UL 85/2025 | Affects D-IFI from eToro and XTB CFDs from tax year 2026 ([04 §2.4](04-si-tax-rules.md#24-contrast-derivatives-under-zddoifi-filed-on-doh-ifi-not-doh-kdvp), verified) |
| Nov 2025 | Crypto-gains bill (ZDDKS) withdrawn from the agenda [M] | Crypto rows stay out of scope for 2026 |
| 19 Dec 2025 | Ur. l. 107/2025: new KP-KDVP Annex 1 for tax year 2025 | Domestic pre-fill format |
| 5 Mar 2026 | INR accounts launch | Exclude INR holdings |
| Apr 2026 | Trade Republic native CSV | Replaces PDF scraping |
| 2025–2026 | Bitpanda Real Securities; legacy derivatives sell-only | Two asset regimes in one CSV |
| 9 Sep 2026 | Ur. l. 1409/2026: new KP-KDVP Annex 1 for tax year 2026 | Domestic pre-fill format |

---

## 6. Synthetic sample files

The research produced a synthetic sample, with exact real headers and no personal data, for every format above: eToro (three sheets as TSV), DEGIRO EN/NL Transactions and Account CSV, XTB XLSX sheets (as TSV) and the CSV variant, Lightyear CSV, Trade Republic CSV, Saxo CSV, Bitpanda CSV, Scalable CSV and Freedom24 JSON. Excerpts appear in §4. The files themselves are not committed with this page.

## Confidence

This page was **not independently verified**. The format descriptions come from parser source code and fixtures (masbug/etoro-edavki, GhostfolioSidekick, DeclaRenta, Export-To-Ghostfolio, BittyTax and others), broker help centers, legislation and forum activity. Body statements tagged [M] or [L] carry the same caveat as the claims below. The popularity ranking in §2 is a proxy, not a statistic.

The researcher rated these critical claims below high confidence:

| Confidence | Claim | Source |
|---|---|---|
| medium | An eToro closed position goes to D-IFI rather than Doh-KDVP if its Type is CFD (or OPT/FUT/FOP/Crypto Margin), or Leverage > 1, or it is a Short position; real assets are only long, unleveraged Stocks/ETF. | [masbug/etoro-edavki](https://github.com/masbug/etoro-edavki/blob/5f607d9e99/etoro_edavki.py) |
| medium | In eToro statements, Amount/Profit/fee columns are in USD while Open Rate/Close Rate are in the instrument's currency; `FX rate at open/close (USD)` converts the instrument currency to USD (`-` or 1 for USD instruments). For leveraged CFDs, Amount is the margin and notional = Amount × Leverage. | [masbug/etoro-edavki](https://github.com/masbug/etoro-edavki/blob/5f607d9e99/etoro_edavki.py) |
| medium | Trade Republic's native CSV export (April 2026) has 23 quoted columns (datetime … mcc_code); `symbol` holds the ISIN, `datetime` is UTC and `date` is the local (Berlin) date. | [GhostfolioSidekick TradeRepublicCsvRecord.cs](https://github.com/VibeNL/GhostfolioSidekick/blob/b0e397559035069670983551ed907216834e6d70/Parsers/TradeRepublic/TradeRepublicCsvRecord.cs) |
| medium | Trade Republic CSV `type` values include BUY, SELL, SAVINGS_PLAN_EXECUTED, DIVIDEND, INTEREST_PAYMENT, MIGRATION, REDEMPTION, FINAL_MATURITY; MIGRATION appears as a −n/+n pair of the same ISIN and is not a disposal. | [GhostfolioSidekick TR test files](https://github.com/VibeNL/GhostfolioSidekick/tree/b0e397559035069670983551ed907216834e6d70/Parsers.UnitTests/TestFiles/TradeRepublic/CSV) |
| medium | XTB cash-operation Type spellings vary (`DIVIDENT`/`Dividend`, `Withholding Tax`/`Withholding tax`, `Stocks/ETF purchase`/`Stock purchase`, localized variants); withholding comments look like `AAPL.US USD WHT 15%`. | [Export-To-Ghostfolio XTB sample](https://github.com/dickwolff/Export-To-Ghostfolio/blob/9e35bd602f054f563b8c728bcb36dc5eb2bbcaa5/samples/xtb-export.csv) |
| medium | DEGIRO's current English Transactions.csv and Account.csv headers are as given in §4.4 (blank headers hold currency codes); dividends and withholding exist only in Account.csv. | [GhostfolioSidekick DEGIRO test files](https://github.com/VibeNL/GhostfolioSidekick/tree/b0e397559035069670983551ed907216834e6d70/Parsers.UnitTests/TestFiles/DeGiro) |
| medium | DEGIRO `Exchange rate` is foreign-currency units per 1 EUR, so Value EUR = Local value / Exchange rate (e.g. −976.00 USD / 1.1564 = −844.00 EUR). | [ishiland/degiro-analytics](https://github.com/ishiland/degiro-analytics) |
| medium | DEGIRO books ISIN changes, splits and share swaps in Transactions.csv as order-less, cost-free sell+buy pairs; treating them as disposals produces a wrong Doh-KDVP. | [DeclaRenta DEGIRO parser](https://github.com/DeclaRenta/declarenta/blob/975617706b15064dacaea1df7d84cebe1aac61f9/src/parsers/degiro.ts) |
| medium | Lightyear's CSV transaction report header and Type values are as given in §4.5, with dates `DD/MM/YYYY HH:MM:SS`. | [DeclaRenta docs](https://declarenta.com/docs.html) |
| medium | Bitpanda's history CSV starts with about 6 preamble lines before the header given in §4.8 and contains no ISIN column. | [BittyTax Bitpanda parser](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bitpanda.py) |
| medium | Scalable Capital's broker is only offered to residents of Germany, Austria, Italy, Spain, metropolitan France and the Netherlands (not Slovenia). | [Scalable trading FAQ](https://de.scalable.capital/en/trading-faq) |
| medium | The ZDDOIFI amendment setting a flat 25% tax on derivative gains regardless of holding period was passed by the National Assembly in October 2025; the separate 25% crypto-gains bill (ZDDKS) was withdrawn from the December 2025 agenda (not in force for 2026). | [Svet24](https://svet24.si/novice/slovenija/davek-od-dobicka-od-odsvojitve-izvedenih-financnih-instrumentov-1856769) |

**Before shipping a parser:** every fixture derived from this page must be validated against real (anonymized) exports from the broker, UI language and export version it claims to represent. The synthetic samples copy headers from public sources and contain no real account data; several formats (Trade Republic dividends, Saxo withholding, Bitpanda Real Securities) have not been seen in a real export at all.

## Open questions

- Exact semantics of Trade Republic CSV dividend fields: is `amount` gross or net EUR, and is `original_amount` gross or net in the original currency? Verify against a TR dividend PDF before using for Doh-Div.
- What Asset class / Transaction Type labels do Bitpanda Real Securities (real shares) use in the CSV, and is an ISIN ever exported? No primary sample found.
- Tax classification under Slovenian law of Bitpanda legacy "Stock (derivative)" contracts: D-IFI (derivative) versus Doh-KDVP. No FURS position found.
- eToro statement time zone (GMT vs local), whether eToro records splits as explicit Account Activity rows, and how partial closes create new Position IDs.
- Whether Slovenian domestic custodians (NLB, Ilirika, Alta, InterCapital) act as withholding agents on FOREIGN-issuer dividends credited to client accounts, or whether clients must still file Doh-Div. Not documented in the sources found.
- How eDavki merges a user-imported Doh-KDVP XML with the pre-filled data from domestic brokers (overwrite versus append), and how to avoid double-reporting when a user has both. ([01 §9](01-furs-doh-kdvp.md#9-importing-into-edavki): an imported PLVP or PLD list that already exists in the return is merged into it, PLVPGB is always added; the merge key is unknown.)
- Effective date and transitional rules of the October 2025 ZDDOIFI amendment (flat 25% on derivatives), which affects eToro/XTB CFD D-IFI computations for tax year 2026. (Effective date answered in [04 §2.4](04-si-tax-rules.md#24-contrast-derivatives-under-zddoifi-filed-on-doh-ifi-not-doh-kdvp), verified: tax years from 1 Jan 2026 under ZDDOIFI-B art. 5. Leveraged trading uses 0.25% + 0.25% normed costs, and CFD financing income is interest on Doh-Obr. Transitional rules beyond that were not covered.)
- Exact DEGIRO header strings for German, French and Italian UIs, and whether the Order ID / trailing-column misalignment is universal. DEGIRO's helpdesk blocks automated fetches (bot check).
- XTB timestamp time zone and the exact FX treatment of `Purchase value`/`Sale value` (conversion rate and 0.5% FX fee) for EUR accounts trading USD stocks.
- Saxo: how dividend withholding tax is represented (separate row versus netted) and which of the two observed Transactions export layouts is current.
- Lightyear: an official help-center description of the CSV "Transaction report" (the help center only documents the PDF statements), and the time zone of its timestamps.
- Whether Freedom24's XLSX/XML broker report formats are stable enough to support alongside JSON, and the full list of `corporate_actions` `type_id` values (split, conversion, spin-off).

## Sources

- [masbug/etoro-edavki – eToro to eDavki converter (parser source with dated header versions)](https://github.com/masbug/etoro-edavki)
- [masbug/etoro-edavki commit 0aadbc5 'Popravki za nov eToro statement' (Nov 2025)](https://github.com/masbug/etoro-edavki/commit/0aadbc5512)
- [eToro Help – What is the eToro account statement?](https://help.etoro.com/s/article/what-is-the-etoro-account-statement?language=en_GB)
- [FX News Group – eToro enhances Account Statement feature (2021)](https://fxnewsgroup.com/forex-news/retail-forex/etoro-enhances-account-statement-feature/)
- [eToro press release – local trading experience in UK and EU (Oct 2024)](https://www.etoro.com/news-and-analysis/press-releases/etoro-enhances-local-trading-experience-in-uk-and-eu/)
- [DeclaRenta – multi-broker parsers (DEGIRO, eToro, Lightyear, Freedom24, Scalable, Trade Republic, flatex)](https://github.com/DeclaRenta/declarenta)
- [DeclaRenta documentation](https://declarenta.com/docs.html)
- [GhostfolioSidekick – Trade Republic CSV, DEGIRO, Scalable parsers and fixtures](https://github.com/VibeNL/GhostfolioSidekick)
- [Export-To-Ghostfolio – broker converters and samples (eToro, XTB, Saxo, DEGIRO)](https://github.com/dickwolff/Export-To-Ghostfolio)
- [Export-To-Ghostfolio issue #190 – real XTB XLSX export attachment](https://github.com/dickwolff/Export-To-Ghostfolio/issues/190)
- [XTB Help Center – History of Positions and Cash Operations](https://www.xtb.com/en/help-center/our-platforms/history-of-positions-and-cash-operations-web-platform-and-mobile-app)
- [Lightyear Help – Taxes and statements](https://lightyear.com/en-eu/help/trading-and-investments/tax-and-statement)
- [Lightyear Help – Dividend taxes](https://lightyear.com/en-eu/help/trading-and-investments/dividend-taxes)
- [Lightyear Help – What services do you offer and where](https://lightyear.com/en-eu/help/getting-verified/what-services-do-you-offer-and-who-is-eligible)
- [Bitpanda Help – Legacy assets on Bitpanda: sell-only mode](https://support.bitpanda.com/hc/en-us/articles/23521681276956-Legacy-assets-on-Bitpanda-sell-only-mode)
- [Bitpanda Help – Real Stocks & ETFs on Bitpanda](https://support.bitpanda.com/hc/en-us/articles/24575224671516-Real-Stocks-ETFs-on-Bitpanda)
- [Bitpanda Help – How can I download the history of my Bitpanda account?](https://support.bitpanda.com/hc/en-us/articles/360000122759-How-can-I-download-the-history-of-my-Bitpanda-account)
- [Bitpanda Help – Tax Reports: Access and Understanding](https://support.bitpanda.com/hc/en-us/articles/18668973207580-Tax-Reports-Access-and-Understanding)
- [BittyTax – Bitpanda CSV parser](https://github.com/BittyTax/BittyTax)
- [N26 Support – How Stocks and ETFs work at N26](https://support.n26.com/en-eu/app-and-features/savings-and-invest/how-stocks-and-etfs-work-at-n26)
- [Scalable Capital – Broker FAQ (eligible countries)](https://de.scalable.capital/en/trading-faq)
- [CryptoImpuestos – How to download your Trade Republic history (CSV export April 2026)](https://cryptoimpuestos.es/en/blog/how-to-download-trade-republic-history/)
- [Startbase – Trade Republic expands into eleven countries incl. Slovenia (Oct 2022)](https://www.startbase.com/news/trade-republic-expandiert-in-elf-laender)
- [Žurnal24 – Kako prijaviti obresti pri Trade Republic (Feb 2025)](https://www.zurnal24.si/slovenija/kako-prijaviti-obresti-pri-trade-republic-436987)
- [Slo-Tech forum – TradeRepublic thread](https://slo-tech.com/forum/t825085)
- [Slo-Tech forum – Etoro in Edavki](https://slo-tech.com/forum/t760618)
- [Slo-Tech forum – Degiro online broker (in alternative)](https://slo-tech.com/forum/t718019)
- [Slo-Tech forum – Izbira on-line brokerja](https://slo-tech.com/forum/t762211)
- [BrokerChooser – Best stock brokers in Slovenia 2026](https://brokerchooser.com/sl/best-brokers/best-stock-brokers-in-slovenia)
- [edavki.rešitve.si – supported brokers](https://edavki.xn--reitve-ckb.si/)
- [DavekNaDobiček – Kako izpolniti Doh-KDVP (supported brokers)](https://daveknadobicek.si/blog/kako-izpolniti-doh-kdvp)
- [rmilosic/edavki-xml-converter – DEGIRO dividends to eDavki](https://github.com/rmilosic/edavki-xml-converter)
- [ib-edavki/ib-edavki (popularity baseline)](https://github.com/ib-edavki/ib-edavki)
- [ZDavP-2 Art. 339 (unofficial consolidated text)](https://zakonodaja.com/zakon/zdavp-2/339-clen-avtomaticno-dajanje-podatkov-v-zvezi-s-pridobitvijo-in-odsvojitvijo-vrednostnih-papirjev-dr)
- [Uradni list RS 1409/2026 – Pravilnik o spremembah Pravilnika o dostavi podatkov ... (new Priloga 1 from tax year 2026)](https://pisrs.si/api/uradni-list/objava/u20261409.pdf)
- [Uradni list RS 107/2025 – Pravilnik o spremembi Pravilnika o dostavi podatkov ...](https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/2025-01-3651)
- [Uradni list RS 80/2019 – Pravilnik o dostavi podatkov za odmero dohodnine od dobička iz kapitala ...](https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/2019-01-3652)
- [FURS/DURS – Usmeritve pri dostavi podatkov KP-KDVP/KP-IFI (2012)](http://www.datoteke.fu.gov.si/eDavki/Usmeritve_KPD-KDVP_KPD-IFI_2013.pdf)
- [Racunovodja.com – D-IFI in Doh-KDVP: podatki iz zunanjih virov na eDavkih](https://www.racunovodja.com/clanki.asp?clanek=6325/D-IFI_in_Doh-KDVP_-_Podatki_iz_zunanjih_virov_na_eDavkih)
- [FURS – Prejel sem dividende](https://www.fu.gov.si/zivljenjski_dogodki_prebivalci/prejel_sem_dividende/)
- [NLB – Individualni naložbeni račun (INR)](https://www.nlb.si/osebno/pomoc-in-orodja/varcevanja-in-nalozbe/inr)
- [Žurnal24 – INR račun, se splača ali ne (Feb 2026)](https://www.zurnal24.si/slovenija/inr-racun-koliko-stane-se-splaca-454579)
- [PISRS – Zakon o individualnih naložbenih računih (ZINR)](https://pisrs.si/pregledPredpisa?id=ZAKO9154)
- [Bizi.si – INTERKAPITAL vrijednosni papiri, Podružnica Slovenija](https://www.bizi.si/INTERKAPITAL-VRIJEDNOSNI-PAPIRI-PODRUZNICA-SLOVENIJA/)
- [Svet24 – ZDDOIFI amendment passed (Oct 2025)](https://svet24.si/novice/slovenija/davek-od-dobicka-od-odsvojitve-izvedenih-financnih-instrumentov-1856769)
- [Poslovni.si – Odložen davek na kriptovalute (Nov 2025)](https://poslovni.si/novice/odlozen-davek-na-kriptovalute-slovenija-ostaja-kripto-oaza-se-vsaj-do-2027)
- [Money-How – Vodnik po davkih za vlagatelje (Feb 2026)](https://money-how.si/blog/vodnik-po-davkih-za-vlagatelje-dileme-pred-oddajo-davcne-napovedi/)
- [Monitor.si – Furs pozna neobanke in spletne borzne posrednike (Jan 2025)](https://www.monitor.si/clanek/furs-pozna-neobanke-in-spletne-borzne-posrednike/238067/)
