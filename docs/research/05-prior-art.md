# Prior art: tools that generate FURS eDavki XML from broker exports

> Researched: 2026-10-07 · Verification: not independently verified
>
> Covers tools for Doh-KDVP, Doh-Div, D-IFI, Doh-Obr and Doh-DHO. Research for building TaxReporter. It is not tax advice, and FURS publications and the law win over anything written here. Where this page overlaps a verified doc (01–03), the verified doc wins; such places are cross-referenced inline. See the [README](README.md#confidence-and-verification-legend) for the legend.

Everything below comes from primary material: GitHub source code and issue trackers (via `gh`), live FURS XSDs and form PDFs, live service websites, and a live request to the BSI rate file. Each item says how it was checked. Repositories were reviewed as shallow clones at these commits: ib-edavki `22220f5` (2026-03-29), etoro-edavki `5f607d9` (2026-02-17), TaxBrokerReport `0550ef3` (2026-10-04), brrr-generator `107907c`.

## TL;DR

- **One dominant open-source tool:** `ib-edavki/ib-edavki` (MIT, 316 stars, created 2017, formerly `jamsix/ib-edavki`). It reads IBKR Flex XML and writes all four classic forms (Doh-KDVP, D-IFI, Doh-Div, Doh-Obr). It is one 1,500-line script with no tests. Its 87 issues are the best record of real filing pitfalls. Most other Slovenian tools copied its XML-writing code (eToro, Trading 212, Revolut forks).
- **Every other OSS tool covers a single broker and is lightly maintained.** Only two have real test suites: `TheCodeFighter/TaxBrokerReport` (C++20, MIT, under heavy rewrite, Trade Republic now and IBKR planned) and `MarjanDB/brrr-generator` (TypeScript, IBKR only, CC BY-NC-SA, so we cannot reuse it).
- **No OSS tool does all of the following together:** multi-broker FIFO across brokers, BSI reference rates, corporate actions, and XSD validation. The commercial and free web services (Davkomat, DavekNaDobiček, Plutko, eTeD, edavki.rešitve.si) cover more brokers. They are closed source, and most upload or store user data.
- **The FURS schemas change without warning.** The live `Doh_KDVP_9.xsd` has `Last-Modified: 2026-08-06`. It adds a `TaxDecreaseCooperative` element and a new acquisition code `K` (transfer from an INR, the individual investment account), but the namespace is still `Doh_KDVP_9`. Every copy bundled in a GitHub tool is stale. (Confirmed in [01 §2](01-furs-doh-kdvp.md#2-primary-files-and-versions), verified.)
- **Recurring failure classes in issue trackers:**
  - broker export formats drift (column headers change);
  - splits, ISIN changes and mergers;
  - FIFO is not applied across accounts or brokers;
  - same-day dividend aggregation, which FURS rejected;
  - withholding-tax matching;
  - XML element order;
  - BSI blocking the default `Python-urllib` user agent;
  - placeholder contact data left in submitted returns.

## 1. Landscape of open-source tools

Star counts, licenses and push dates come from the GitHub API on 2026-10-07.

| Repo | Lang | License | Stars | Last push | Brokers | Forms | FX source | Tests |
|---|---|---|---|---|---|---|---|---|
| ib-edavki/ib-edavki | Python | MIT | 316 | 2026-03-29 (PRs open into 2026) | IBKR Flex XML | Doh-KDVP, D-IFI, Doh-Div, Doh-Obr | BSI `dtecbs-l.xml` | none (issue #200) |
| masbug/etoro-edavki | Python | MIT | 62 | 2026-02-17 | eToro XLSX account statement | Doh-KDVP, D-IFI, Doh-Div | BSI (USD only) + eToro FX for non-USD | none |
| Neophytez/t212-edavki | Python | **none** | 41 | 2026-02-04 | Trading 212 CSV | Doh-KDVP | bundled ECB USD/EUR CSV; T212 rate for other currencies | none |
| zvranesic/t212-edavki (+ `-graphical`) | Python | MIT* | 14 / 2 | 2026-01 | Trading 212 CSV | Doh-KDVP | ECB `eurofxref-hist.zip` | none |
| TheCodeFighter/TaxBrokerReport | C++20 | MIT | 31 | 2026-10-06 | Trade Republic CSV (IBKR planned) | Doh-KDVP, Doh-Div, Doh-DHO (Doh-Obr planned) | user enters official BSI rate by hand | 45 test files, 7 CI workflows, Valgrind, Cppcheck |
| MarjanDB/brrr-generator (taxesgobrrr.com) | TypeScript | CC BY-NC-SA 4.0 | 8 | 2026-08-22 | IBKR Flex XML | Doh-KDVP, D-IFI, Doh-Div (+CSV) | IBKR `fxRateToBase` | 24 test files (vitest) |
| Hafinator/LazyFURS | C# | GPL-3.0 | 11 | 2026-01-16 | eToro XLSX | Doh-KDVP, D-IFI, Doh-Div, Doh-Obr | n/a | none |
| JakaCikac/revolut-edavki | Python/Flask | custom non-commercial | 3 | 2026-02-15 | Revolut CSV | Doh-KDVP, Doh-Div, "IFI" | Revolut's own `FX Rate` column | pytest (6) |
| matevzpoljanc/revolut-savings-account-tax-reports | TS/Next.js | MIT | 31 | 2026-01-29 | Revolut Savings (money-market funds) | Doh-KDVP, Doh-Obr | `api.bsi.si/exchange/daily` → static JSON | Jest |
| webamMarko/revolut-edavki-converter | Python | MIT | 0 | 2026-09-01 | Revolut stocks/CFD/crypto/savings | Doh-KDVP | Yahoo Finance (for analytics) | ? |
| jsitla/Revolut-tax-investing-account | TS (browser) | none | 0 | 2026-01-31 | Revolut trading statement | Doh-KDVP, Doh-Div | uses CSV values as-is (README admits it) | some |
| UnholyPhoenix/ibkr2dohkdvp | Python | MIT | 0 | 2025-05-15 | IBKR | "DOH-KDVP" | ECB/Frankfurter/VATComply | n/a |
| Bizyak13/etoro-furs | Python | MIT | 0 | 2026-02-05 | eToro XLSX | Doh-Div **CSV** | BSI | none |
| rmilosic/edavki-xml-converter | Python | MIT | 0 | 2025-01-31 | DEGIRO account CSV (dividends, USD only) | Doh-Div | ? | ? |
| FerixFTW/IFIParse | Python | none | 0 | 2024-02 | Capital.com CSV | D-IFI helper (console) | BSI | none |
| janlebar/saxo-slovenian-taxreport-xml-generate | Python | none | 0 | 2025-03 | Saxo XLSX | Doh-KDVP | ECB XML | none |
| Ocepek-Domen/etoro_t212_edavki_merge | Python | none | 1 | 2025-02 | merges the eToro and T212 KDVP XML outputs | Doh-KDVP | — | none |
| rokstar743/DavkarApp | Dart/Flutter | none | 2 | 2026-05 | eToro | Doh-KDVP, D-IFI, Doh-Div | ? | ? |
| robiweb74/TradeRepublic2davki | Python/tkinter | none | 0 | 2025-12 | manual entry | Doh-KDVP | manual EUR | none |
| mihastele/slovenski-februarski-beraci, AndrazTom/valuationFramework, invest-eng/engineering-investor | Python/JS | none | 0–1 | 2026 | Revolut + T212 / mixed | KDVP, Div, Obr | yfinance etc. | — |

\* zvranesic credits the unlicensed Neophytez code as its base, so its MIT grant has a provenance problem.

`UnholyPhoenix/ibkr2dohkdvp` is a warning case. It validates against an invented schema (`Doh_Kdvp_1_8.xsd`, root `<VlogaDohKdvp>`, elements `<Zavezanec>`, `<Napoved>`, `<DatumNakupa>`). That is not a FURS schema and eDavki would never accept it. It looks AI-generated, so XSD validation is only meaningful against the live FURS XSDs.

## 2. Deep dives into the cloned repos

### 2.1 ib-edavki (IBKR → all four forms)

**Input.** An IBKR Activity Flex Query in XML with these sections:

- Account Information (`ibEntity`, `accountId`)
- Trades (options *Executions* and *Closed Lots*)
- Corporate Actions
- Cash Transactions (Dividends, Payment in Lieu, Withholding Tax, Broker Fees, Broker Interest Received)
- Financial Instrument Information

The user must pass one file per trading year. The README warns that Slovenian accounts moved IBUK → IBCE (2021) → IBIE (mid-2024), each time with a new account ID, so the query must select Open, Closed and Migrated accounts.

**Instrument identity.** Trades are merged in the order ISIN > CUSIP > securityID > conid > symbol. CUSIP/ISIN changes are found by a regex on the corporate-action `description` (`… CUSIP/ISIN CHANGE TO (…)`). Splits are found by `SPLIT (n) FOR (m) (`. The author's comment says IB "does not provide any information on what the corporate action is". In fact the Flex `type` attribute carries codes such as `FS`, `RS`, `IC`, `SO`, `TC`, `SD` and `DW` (see the `ibflex` enum, MIT).

**FIFO.** ib-edavki does **not** run its own FIFO. For each closing trade in the report year it lists the opening trades named in IBKR's `<Lot>` rows (the closed-lot `transactionID`s) and lets eDavki apply FIFO to that subset. The maintainer confirmed that "FURS requires FIFO over all accounts and brokers" (issue #171); [01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing) confirms the rule from the FURS opis (verified). If IBKR's lot-matching method is not FIFO, or positions span accounts, the listed purchases are wrong. Issues #171 and #167 are real cases.

Other trade handling:

- Partial executions are merged by `ibOrderID` at a volume-weighted price.
- `openCloseIndicator="C;O"` trades are split into a close and an open.
- Open PR #213 says three things are still broken:
  - C;O trades are dropped by a strict `== "C"` filter.
  - ISIN-changing reverse splits create two inventory lists.
  - Mixed long and short positions across accounts push F8 negative, and eDavki then rejects the file. (The rejection rule itself is unverified; see [01 Verification](01-furs-doh-kdvp.md#verification).)

**Money handling:**

- Prices are converted per unit: `tradePrice / BSI rate on trade date`.
- Commissions are ignored. eDavki applies its own 1% + 1% standard costs. The brrr-generator docs and the DavekNaDobiček and Plutko pages all describe this; [01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing) confirms it from the FURS opis (verified).
- All values are binary floats formatted with `"{0:.4f}"`.

**Exchange rates:**

- Downloads `https://www.bsi.si/_data/tecajnice/dtecbs-l.xml` (full history since 2007, about 7.7 MB) once a day with `User-Agent: ib-edavki`.
- If a date is missing, falls back up to 9 previous days. ([02 §9](02-furs-doh-div-and-others.md#9-business-rule-validation-the-app-must-add) reports 6 days; the sources conflict.)
- Maps `CNH` to `CNY` because BSI does not publish CNH (issue #58). Verified: the 2026-10-06 BSI list has 29 currencies and no CNH or GBX.
- The Doh-Obr generator has a separate fallback, `str(int("20250301") - 1)`, which produces invalid dates across month boundaries. It also checks `if i == 6` inside `range(0, 6)`, so the error branch never runs.

**Doh-Div:**

- Dividends are dated by the CashTransaction `dateTime`.
- Withholding tax is matched to a dividend by same date, same symbol and a lower `transactionID`. Ties are broken by fuzzy string matching on the description (`difflib.SequenceMatcher`).
- Reversals are canceled by matching equal and opposite amounts.
- Payer data (name, address, tax ID, country) comes from a crowd-sourced `companies.xml` (MIT). It has 438 entries: 429 with a tax number, 284 with a conid, only 69 with an ISIN; 235 are US companies.
- The script **downloads `companies.xml` and `relief-statements.xml` from GitHub `master` at runtime**. That file covers 17 treaty countries, e.g. US → `10/01, 2b odstavek 10. člena`, and the script writes it into `ReliefStatement` automatically. (FURS describes that field as an exemption claim; see [02 §6](02-furs-doh-div-and-others.md#6-foreign-tax-reliefstatement-and-treaties), verified.)
- `Type` is always `1`.
- An earlier version summed same-day dividends. FURS then wrote to a user: "two payments on the same day, one with withholding tax and one without … you summed both … you must enter as many payments as are on the evidence; summing is not allowed" (issue #42, 2022).

**Doh-Obr:**

- Interest comes from "Broker Interest Received" and "Broker Fees", with `Type` = `2`.
- Payer data comes from `ib-affiliates.xml` (IB-UK, IB-CE, IB-IE, IB-LUX, IBLLC-US).
- Element order mattered. `Country2` written before `Type` caused the eDavki error "Na mestu '6' … napačen element 'Type'". When `Country2` (source country) was missing, every row needed manual fixing (issues #172, #176).

**D-IFI.** Asset categories map to `Type`: FUT → `01`, CFD/FXCFD → `02`, OPT/FOP → `03`, other (WAR) → `04`. `TypeId` is `PLIFI` or `PLIFIShort`. `F9` (leverage) is always `false` (marked as unfinished in the code). `Code` is omitted for options because eDavki rejects their long descriptions.

**Other features:**

- Option `-t` writes `DocumentWorkflowID=I` (informational) and shifts dates into the previous year, so users can preview the current year's tax.
- Issue #94 records an answer from FURS: option expiry, and exercise into shares, is **not** a disposal under ZDDOIFI.
- Issue #175 quotes FURS: spot FX conversions are not derivatives.

### 2.2 masbug/etoro-edavki (eToro XLSX)

- Derived from ib-edavki (MIT).
- Reads the sheets `Closed Positions`, `Account Activity` and `Dividends`. The code documents the eToro header versions **2022, 2023, 2024, 2024.7, 2024.8, 2025.1, 2025.2, 2025.2.15 and 2025.11**:
  - Columns were added: `Long / Short`, `Market Spread (USD)`, `FX rate at open (USD)`, `FX rate at close (USD)`, `Franked/Unfranked`.
  - Columns were renamed: `Units` → `Units / Contracts`, `Stop lose rate` → `Stop loss rate`.
  - The ISIN column was removed in 2025.1 and came back later. Issue #46: users had to add ISINs by hand.
- Each eToro *position* becomes an open/close pair. That is broker lot identification, not FIFO across positions.
- Non-USD instruments are converted twice: instrument currency → USD at eToro's `FX rate at open/close`, then USD → EUR at the BSI rate.
- Gross dividend = (net USD + withheld USD) / BSI rate. A user noticed a 2-cent difference from the expected gross (issue #67).
- Same-day dividends for the same symbol are merged, and the **ISIN is written as `PayerIdentificationNumber`**. (Merging same-day payments is what FURS rejected in ib-edavki #42; see §4 and [02 §5](02-furs-doh-div-and-others.md#5-one-record-per-payment-and-payer-ids).)
- Leverage > 1 makes a trade a derivative (D-IFI with `F9=true`).
- Real crypto is skipped unless `-c` is passed.
- BSI blocks Python's default user agent ("FU bsi!" comment), so the tool sends a browser user agent. Checked on 2026-10-07: `Python-urllib/3.12` gets HTTP 403; `curl` and custom user agents get 200.
- Issues fixed after eDavki rejections:
  - `Securities/Code` longer than 10 characters (#31);
  - D-IFI quantities rounded to 4 decimals became 0 (#30);
  - empty `edp:Header` (#29);
  - missing `DocumentWorkflowID` in Doh-Div ("Polje 'Vrsta dokumenta' mora biti obvezno izpolnjeno", #2).

### 2.3 Trading 212 scripts (Neophytez and zvranesic)

**Neophytez:**

- Writes **one `KDVPItem` per transaction**, with `F8=0` everywhere. The author says eDavki recomputes inventory when the user clicks "Izračun".
- Uses the ticker as `Code`, never writes the ISIN, sets `F10=true` on every sale and `HasLossTransfer=true`.
- Has an option for rounding to 8 decimals.

**zvranesic:**

- Runs its own FIFO.
- Includes earlier-year lots only when a current-year sale consumes them.
- Stock splits are configured by hand in `settings.py`.
- Converts GBX at GBP / 100.
- Prints a "FURS profit" figure after a 1% + 1% cost adjustment (console only).

**Trading 212 CSV headers change from year to year and with the export options:**

- 2021: `Action,Time,ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Charge amount,…,Currency conversion fee,Currency (Currency conversion fee)`
- 2022: no `Result` column.
- 2025: adds `French transaction tax,Currency (French transaction tax)`.
- `Withholding tax` columns appear only when the export contains dividends (Neophytez issues #13 and #22).

Parsing columns by position caused wrong prices (#22). The action set needed to grow to include `Stop sell` (#19).

### 2.4 TaxBrokerReport (best engineering and best design docs)

The repo is under rewrite. `main` has the parser and merger code. The XML generators are empty placeholders; the working generator is in `legacy-QT-GUI/src/backend/xml_generator.cpp`. The docs (`docs/fifo.md`, `calculations.md`, `tax_rules.md`, `diagnostics.md`, MIT) are the most thorough public rule specification. Main points:

- One FIFO pool per ISIN across all brokers and accounts. Missing history is an error, never guessed.
- Fixed-point decimals: Money 4dp, Units 8dp, Rate 8dp. Arithmetic uses checked 256-bit integers and rounds half away from zero, only at the final boundary.
- Small quantity residues (< 0.000001 units, EUR impact < 0.01) are reconciled with recorded evidence.
- Loss-rule (F10) eligibility is computed per FIFO slice, using adjacent-year data.
- Interest is routed by type:
  - Trade Republic interest from **2023-12-06** counts as bank-deposit interest and goes to Doh-DHO, subject to the EUR 1,000 allowance shared across SI/EU banks.
  - IBKR cash interest goes to Doh-Obr.
- `ReliefStatement` is left empty unless the user actually claims a treaty exemption.

The Trade Republic CSV fixtures show the export schema: `datetime,date,account_type,category,type,asset_class,name,symbol(=ISIN),shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,…`. Types include `BUY`, `SELL`, `SAVINGS_PLAN_EXECUTED`, `DIVIDEND`, `DISTRIBUTION`, `INTEREST_PAYMENT`, `BOND_INTEREST` and `SPLIT`. The quantity on a `SPLIT` row could mean either the added units or the new total. The tool leaves the ratio unresolved and asks the user, rather than guessing.

### 2.5 brrr-generator (IBKR, typed, tested, not reusable)

- Clean extract → transform → lot-matching pipeline, with FIFO and "provided lots" modes, Zod schemas and vitest fixtures for IBKR XML cases.
- License is CC BY-NC-SA 4.0, so no code reuse.
- Its `EDavkiDividendType` enum (`3=LIQUIDATING`, `5`, `6=BONUS`) **does not match** the FURS code list. A "bonus" dividend maps to code `4`, which means investment-fund distribution.
- EUR values come from IBKR's `fxRateToBase`, not BSI rates.

## 3. The XML existing tools emit

All tools target the same namespaces under `http://edavki.durs.si/Documents/Schemas/`: `Doh_KDVP_9.xsd`, `Doh_Div_3.xsd`, `D_IFI_4.xsd`, `Doh_Obr_2.xsd` and `Doh_DHO_4.xsd` (TaxBrokerReport only), plus `EDP-Common-1.xsd` with prefix `edp`.

Doh-KDVP as written by ib-edavki (structure checked against the live XSD):

```xml
<Envelope xmlns="http://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd"
          xmlns:edp="http://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd">
  <edp:Header><edp:taxpayer><edp:taxNumber>…</edp:taxNumber><edp:taxpayerType>FO</edp:taxpayerType>
    <edp:name>…</edp:name><edp:address1>…</edp:address1><edp:city>…</edp:city>
    <edp:postNumber>…</edp:postNumber><edp:postName>…</edp:postName></edp:taxpayer></edp:Header>
  <edp:AttachmentList/><edp:Signatures/>
  <body><edp:bodyContent/>
    <Doh_KDVP>
      <KDVP><DocumentWorkflowID>O</DocumentWorkflowID><Year>2025</Year>
        <PeriodStart>2025-01-01</PeriodStart><PeriodEnd>2025-12-31</PeriodEnd>
        <IsResident>true</IsResident><TelephoneNumber>…</TelephoneNumber>
        <SecurityCount>n</SecurityCount><SecurityShortCount>m</SecurityShortCount>
        <SecurityWithContractCount>0</SecurityWithContractCount>
        <SecurityWithContractShortCount>0</SecurityWithContractShortCount>
        <ShareCount>0</ShareCount><Email>…</Email></KDVP>
      <KDVPItem><InventoryListType>PLVP</InventoryListType><Name>…</Name>
        <HasForeignTax>false</HasForeignTax><HasLossTransfer>false</HasLossTransfer>
        <ForeignTransfer>false</ForeignTransfer><TaxDecreaseConformance>false</TaxDecreaseConformance>
        <Securities><ISIN>…</ISIN><Code>≤10 chars</Code><Name>…</Name><IsFond>false</IsFond>
          <Row><ID>0</ID><Purchase><F1>date</F1><F2>B</F2><F3>qty</F3><F4>EUR/unit</F4><F5>0.0000</F5></Purchase><F8>running qty</F8></Row>
          <Row><ID>1</ID><Sale><F6>date</F6><F7>qty</F7><F9>EUR/unit</F9></Sale><F8>0.0000</F8></Row>
        </Securities></KDVPItem>
    </Doh_KDVP></body></Envelope>
```

Facts from the live XSDs (fetched 2026-10-07):

**Doh-KDVP**

- `Doh_KDVP` children in order: `KDVP`, `TaxRelief*`, `TaxBaseDecrease*`, `Attachment*`, `KDVPItem*`.
- `KDVPItem` children in order: `ItemID?`, `InventoryListType`, `Name` (≤100), `HasForeignTax`, `ForeignTax`, `FTCountryID` (**3-digit numeric**, pattern `[0-9]{3}`), `FTCountryName`, `HasLossTransfer` (loss carry-forward, 97/3 ZDoh-2), `ForeignTransfer`, `TaxDecreaseConformance`, `TaxDecreaseCooperative` (new), then exactly one of `Securities`, `SecuritiesShort`, `Shares`, `SecuritiesWithContract`, `SecuritiesWithContractShort`, `SecuritiesCapitalReduction`. (At XSD level each option of that choice is `minOccurs=0`, so an item with no list element validates; eDavki, however, counts a list as correctly entered only with at least one purchase and one sale. See [01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing), verified.)
- `InventoryListType` values: `PLVP`, `PLVPSHORT`, `PLVPGB`, `PLVPGBSHORT`, `PLD`, `PLVPZOK`.
- Numeric formats: F3/F7 `\d{1,12}(\.\d{1,8})?`; F4/F9 `\d{1,14}(\.\d{1,8})?` (per unit); F5 `\d{1,10}(\.\d{1,4})?`; F8 `[-]?\d{1,12}(\.\d{1,8})?`. `Code` maxLength 10, `ISIN` maxLength 12. `F10` is a boolean (the 97/2+5 loss rule).
- `F2` codes depend on the list type:
  - The XSD annotation and the long-list legend on the 2025 form (MF-FURS obr. DOHKAP št. 4, Uradni list RS 107/2025, 19.12.2025) say `A` vložek kapitala, `B` nakup, `C`–`H` …, `I`, `J`, and now `K` (transfer from INR). (Per [01 §6](01-furs-doh-kdvp.md#6-acquisition-method-codes-f2-type-typegaintype), verified: the printed form's PLVPZOK legend uses `I` for the start-up code where PLVP uses `J`, and the PLVPGB 2026 legend uses `I` for the INR transfer.)
  - The **short-sale lists on the same form, and D-IFI, use `A` nakup, `B` dedovanje, `C` darilo, `D` drugo.** ib-edavki therefore writes `B` on PLVP and `A` on PLVPSHORT and D-IFI. This matches the forms, even though the D-IFI XSD annotation (copied from KDVP) says otherwise.

**Doh-Div**

- `body` contains `Doh_Div` (Period, EmailAddress, PhoneNumber, ResidentCountry, IsResident, …) **followed by sibling `Dividend*` elements**. There is no `edp:bodyContent`.
- `Dividend` children in order: `Date`, `PayerTaxNumber` (Slovenian payers), `PayerIdentificationNumber`, `PayerName`, `PayerAddress`, `PayerCountry`, `Type`, `Value`, `ForeignTax`, `SourceCountry`, `ReliefStatement`. Amounts have 2 decimals.
- `DocumentWorkflowID` goes in `edp:Header/edp:Workflow`.
- `Type` codes from the FURS instructions: 1 dividend; 2 hidden profit distribution; 3 profit on profit-participating debt securities; 4 investment-fund profit or income distribution; 5–7 other cases. Every surveyed tool hard-codes `1`, except brrr-generator, whose enum (§2.5) does not match the FURS list.

**D-IFI**

- `body` = `edp:bodyContent`, then `D_IFI`.
- `TItem` children: `TypeId` (`PLIFI`/`PLIFIShort`), `Type` `0[1-4]`, then either `TSubItem` (Purchase F1–F4 + F9 leverage; Sale F5–F7; F8) or `TShortSubItem` (Sale F1–F3 + F9; Purchase F4–F7; F8).

**Doh-Obr**

- `body` = `edp:bodyContent`, then `Doh_Obr` (Period, DocumentWorkflowID, Email, TelephoneNumber, ResidentOfRepublicOfSlovenia, Country, `Interest*`).
- `Interest` children in order: Date, TaxNumber (int), IdentificationNumber (≤30), Name, Address, Country, Type, Value, ForeignTax, Country2, ReliefStatement (≤100).

## 4. Pitfalls from issue trackers, and what they mean for us

| Pitfall | Evidence | Implication |
|---|---|---|
| Summing same-day dividends was rejected by FURS | ib-edavki #42 (FURS email) | One `Dividend` row per payment on the evidence |
| Same payer and same day with an identical identification number gives a critical error; FURS suggests numbering the rows 1, 2, … | FURS `doh_odm_div_csv.n.docx` | Make `PayerIdentificationNumber` unique per (payer, date) or follow FURS's workaround |
| PayerIdentificationNumber > 12 characters was silently dropped on submission | #86 (2023); maintainer says no longer limited (2025-02-25, #163) | Warn, don't truncate; open question |
| Withholding-tax rows can't be reliably linked to dividends; reversals; tax booked in a later year | #4, #100, #117, #136 | Match on stable keys (actionID, ISIN, ex/pay date), support cross-year files, show unmatched rows |
| Splits, reverse splits with ISIN/conid change, spinoffs, mergers, stock dividends | #106, #121, #177, #181, #202, PR #205, PR #213 | Model corporate actions explicitly from `type` codes; dedupe across overlapping exports |
| FIFO across accounts and brokers | #171; Ocepek-Domen merge tool; rešitve.si notes brokers close "by ID, not FIFO" | Own FIFO engine across all sources, keyed by ISIN |
| Missing prior-year history makes sales look like short sales | Davkomat FAQ; ib-edavki #21, #34 | Require full history; detect and explain shortfalls |
| F8 below zero in a long list causes rejection | PR #213 (unverified; see [01 Verification](01-furs-doh-kdvp.md#verification)) | Validate the inventory invariant before writing |
| Two Doh-Div import paths: XML via *Dokumenti › Uvoz*, CSV only through the form's CSV button | Davkomat FAQ | Say clearly in the UI which path to use |
| Placeholder email left in returns; FURS contacted the tool author | Davkomat FAQ | Never write default contact data |
| BSI returns 403 to `Python-urllib` | etoro-edavki code; checked on 2026-10-07 | Send an explicit user agent; cache and checksum |
| Rate missing for a currency (CNH) or a sub-unit (GBX) | #58; zvranesic `to_eur` | Normalize currencies, fail loudly |
| Hard-coded instrument routing (VWCE treated as "index fund" in D-IFI) | JakaCikac converter | Classify instruments; UCITS ETFs are securities (KDVP) |

## 5. Commercial and web services

Pricing as published on 2026-10-07:

| Service | Model | Price | Brokers | Forms | Notes |
|---|---|---|---|---|---|
| Davkomat (davkomat.si) | web app, "Beta" | free (donations) | IBKR/CapTrader/OptimTrader full; Trading 212; Revolut, Revolut Savings, N26, Plus500, Lightyear, Schwab (partial); own spreadsheet | Doh-KDVP, D-IFI, Doh-Div, Doh-Obr/Doh-DHO | Google Analytics; says data is deleted after conversion; refuses eToro and Trade Republic; r/davkomat for support |
| DavekNaDobiček (daveknadobicek.si) | account web app, data stored in Frankfurt | free (donations) | T212, Revolut, IBKR, eToro, Trade Republic, DEGIRO, Lightyear, N26, XTB | Doh-KDVP, Doh-Div, D-IFI, Doh-DHO, Doh-Obr | ECB rates, standard costs, wash-sale detection |
| Plutko (plutko.si) | account web app | EUR 29.99 per tax season (pay to download XML) | IBKR, Revolut, eToro, T212, Trade Republic, XTB, Vantage | Doh-KDVP | BSI rates |
| eTeD (etoro-edavki.si / pretvorba-edavki.si) | Windows desktop app or done-for-you | EUR 33/year (eToro Silver+), EUR 40/year, EUR 60 done-for-you | eToro, Plus500, T212 Invest, IBKR, Revolut | Doh-KDVP, D-IFI, Doh-Div, Doh-Obr | Tax years 2018–2025; claims 1,000+ users since 2020 |
| edavki.rešitve.si | manual service | minimum EUR 125; EUR 75 per year; EUR 50–100 per security for corporate-action fixes | eToro, IBKR, Saxo, Revolut, T212, Trade Republic (from PDF) | Doh-KDVP, D-IFI, Doh-Div, Doh-Obr, Doh-DHO | Asks for the full trading history |
| Portfelj (portfelj.net) | closed-source desktop CLI | free | IBKR Flex | Doh-KDVP, Doh-Div, D-IFI | Directory of 12,000+ US companies with EINs |
| taxesgobrrr.com | hosted brrr-generator | free | IBKR | as brrr-generator | |
| vemkajze.wixsite.com/trading212-davki | Windows app | free | T212 | Doh-KDVP | No split or currency handling (per its own page) |

## 6. Community resources

- **Slo-Tech forum, "Etoro in Edavki"** (slo-tech.com/forum/t760618): about 200 posts from 2022 to March 2026. Covers eToro/IBKR/Saxo exports, splits, the CFD vs crypto split, and CSV vs XML import.
- **Reddit:** r/davkomat (linked from Davkomat) and r/SloveniaTrades (linked from rešitve.si). Search engines index Reddit poorly, so no specific threads were verified.
- **Guides:**
  - daveknadobicek.si/blog/kako-izpolniti-doh-kdvp
  - plutko.si/blog (Doh-KDVP 2025)
  - edavki.rešitve.si/davcna-napoved.php
  - slotrade.blogspot.com/p/davki.html
  - The official eDavki help page `Documents_New_Doh_KDVP.htm`
- **med.over.net:** no relevant thread was confirmed (low confidence).
- **Issue trackers:** ib-edavki and etoro-edavki issues are effectively the community FAQ. They contain the FURS answers quoted above.

## 7. Reusable libraries from other countries

Our project is AGPL-3.0, so inbound licenses must be compatible with it.

| Project | License | Use for us |
|---|---|---|
| csingley/ibflex (Python) | MIT | Typed IBKR Flex XML parser, including corporate-action `Reorg` codes (FS/FI/RS/IC/SO/TC/SD/DW/TO/TM) |
| clifton/ib-flex (Rust) | MIT | Alternative Flex parser |
| cgt-calc/capital-gains-calculator | MIT | UK CGT tool; parsers for Trading 212, IBKR, Revolut, Schwab, Freetrade, Vanguard, Morgan Stanley; good T212 handling |
| dickwolff/Export-To-Ghostfolio | Apache-2.0 | Tested converters for T212, Revolut, IBKR, eToro, DEGIRO (v1–v3), XTB, Trade Republic, Saxo, Schwab, Swissquote, Bitvavo and others; good source of fixtures and format knowledge |
| ghostfolio/ghostfolio, rotki/rotki | AGPL-3.0 | Compatible, but mostly their own import formats |
| portfolio-performance/portfolio | EPL-1.0 | **Incompatible** with the GPL family. Use only as a behavioral reference: PDF extractors for Trade Republic, DEGIRO, Scalable, Revolut, Saxo, N26, Trading212, Swissquote, plus `IBFlexStatementExtractor` |
| pytr-org/pytr | MIT | Trade Republic document and transaction downloader |
| Chavithra/degiro-connector | BSD-3 | DEGIRO API |
| tarioch/beancounttools | MIT | IBKR Flex importer for Beancount |
| Polish PIT-38: Pitly (MIT), pbialon/pit-38 (MIT), SkeLLLa/klopit (AGPL-3.0), wronski04/tax212-pit38 (AGPL-3.0) | | Same problem shape: NBP rates there play the role of BSI rates here |
| German: KonvexInvestment/ibkr-steuer (MIT), Fsaupe/ibkr-german-tax-declaration-engine (MIT) | | IBKR Flex → tax forms |
| vaijira/burocratin (Rust) | AGPL-3.0 | IBKR/DEGIRO → Spanish forms |
| beangulp, beancount-import | GPL-2.0 | Check whether "-only" or "-or-later" before reusing |

Among Slovenian tools, code we may legally reuse:

- ib-edavki (MIT), including its `companies.xml`, `relief-statements.xml` and `ib-affiliates.xml` data;
- etoro-edavki (MIT); TaxBrokerReport (MIT); matevzpoljanc (MIT);
- LazyFURS (GPL-3.0, which can be combined into an AGPL-3.0 work).

Code we must **not** copy: brrr-generator (NC), JakaCikac (NC), and every repo with no license (Neophytez, arruw, jsitla and others).

## 8. Changes in 2025/2026 that affect tools

- **XSD changed without a version bump.** `Doh_KDVP_9.xsd` is `Last-Modified 2026-08-06`. It adds `TaxDecreaseCooperative` (ZLZD employee-ownership cooperatives) and F2 code `K` (INR transfers; individual investment accounts operate from 2026-03-05). Code `J` (innovative start-up shares under 45.b ZDoh-2, not an INR code) was added earlier, between 2025-06 and 2026-01 (corrected per [01 §2](01-furs-doh-kdvp.md#2-primary-files-and-versions), verified). The other XSDs are dated 2025-12-19.
- **New KDVP form version.** The form legend was republished as obr. DOHKAP št. 4 (Uradni list RS 107/2025).
- **Trade Republic.** Its CSV export is now used by tools (TaxBrokerReport). Its interest after 2023-12-06 is treated as bank-deposit interest (Doh-DHO; filing required above EUR 1,000 per fu.gov.si).
- **IBKR.** The IBCE → IBIE migration in 2024 means users have several account IDs.
- **Broker format drift.** eToro changed headers four or more times in 2024–2025, including removing the ISIN. Trading 212 adds and removes columns.
- **Crypto.** The 25% crypto-gains tax was postponed (removed from the December 2025 agenda; not in force in 2026; low confidence on its later status).

## 9. Gaps, lessons and what our project should do differently

1. **Own deterministic FIFO across all brokers and accounts, keyed by ISIN.** Write exactly the consumed lot slices for each tax-year sale, never the broker's own lot matching. Check F8 ≥ 0 in long lists and ≤ 0 in short lists before writing.
2. **Decimal arithmetic only.** Store per-unit values at 8 decimals. Round dividend `Value` and `ForeignTax` per payment to 2 decimals. Write the rounding rule down and test it.
3. **BSI reference rates with full provenance.** Record the rate date per row. Use an explicit "last published day before" fallback. Normalize currencies (GBX/GBp, CNH, ILA, ZAc). Send our own user agent and keep a local cache. Never use broker FX or Yahoo rates.
4. **Live-XSD validation in CI, plus a scheduled job** that diffs the FURS XSDs (hash, Last-Modified, ETag) and fails when FURS edits them. Pin the field order in golden XML fixtures for all five forms.
5. **Versioned broker parsers** that read columns by header name, detect the format version (T212 2021–2025, eToro 2022–2025.11), use synthetic fixtures for each version, and fail loudly on unknown actions or columns. Reuse ideas and fixtures from cgt-calc, Export-To-Ghostfolio and ibflex.
6. **Corporate actions as first-class events.** Use IBKR `type` codes, not description regexes. Handle ISIN changes, reverse splits, spinoffs and mergers, and dedupe overlapping exports by `transactionID`/`actionID`.
7. **Dividend correctness:**
   - one row per payment;
   - robust withholding matching across years;
   - a versioned payer-metadata dataset with sources (seed from ib-edavki MIT data, never fetched from `master` at runtime);
   - unique same-day payer IDs;
   - `ReliefStatement` only on explicit user choice;
   - the code 1 vs 4 question for fund distributions settled with FURS before release.
8. **Interest routing** between Doh-Obr and Doh-DHO, with the EUR 1,000 deposit allowance and explicit handling of Revolut Savings money-market funds.
9. **Local-first and private.** No uploads, no analytics, no default contact data. Users must enter their own email and phone.
10. **Explainability.** A per-row audit CSV that can be attached as evidence. UX guidance on the two import paths, the "Izračun" button, and an informational (`I`) mode similar to ib-edavki's `-t`.
11. **Classification.** UCITS ETFs and stocks go to KDVP; CFDs, futures and options to D-IFI with the leverage flag; spot FX and private crypto are excluded, with an explanation.

## Confidence

This page was **not independently verified**. It is a single researcher's survey, built from source code, issue trackers and service websites. Where it overlaps the adversarially verified docs ([01](01-furs-doh-kdvp.md), [02](02-furs-doh-div-and-others.md), [03](03-bsi-exchange-rates.md)), those docs win, and the overlaps are cross-referenced inline above.

The researcher rated these critical claims below high confidence:

| Confidence | Claim | Source |
|---|---|---|
| medium | Doh-KDVP F2 codes differ by list type: in long PLVP lists B = nakup and A = vložek kapitala; in short-sale lists and on the D-IFI form A = nakup, B = dedovanje, C = darilo, D = drugo. ib-edavki writes B for PLVP and A for PLVPSHORT and D-IFI purchases. (Short-list part confirmed in 01, verified.) | [Doh-KDVP form 2025](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.i.sl.pdf) |
| medium | FURS rejected a Doh-Div that summed two same-day payouts from one payer (one with withholding tax, one without); each payment on the evidence must be a separate row. (Confirmed in 02, verified.) | [ib-edavki #42](https://github.com/ib-edavki/ib-edavki/issues/42) |
| medium | FURS requires FIFO across all of a taxpayer's accounts and brokers; ib-edavki lists only the opening trades IBKR matched via `<Lot>` rows, so a non-FIFO IBKR lot method or a split position gives a wrong purchase set. (FIFO rule confirmed in 01, verified.) | [ib-edavki #171](https://github.com/ib-edavki/ib-edavki/issues/171) |
| medium | eDavki rejects Doh-KDVP files where F8 goes below 0 in a long list or above 0 in a short list. (The verifier of 01 rated this uncertain.) | [ib-edavki PR #213](https://github.com/ib-edavki/ib-edavki/pull/213) |
| medium | eDavki has two Doh-Div import paths: a full XML envelope must go through Dokumenti > Uvoz; the in-form CSV button accepts only the FURS CSV format and rejects XML with "Kritične vsebinske napake, datoteka ni pravilne oblike". | [Davkomat FAQ](https://davkomat.si/faq) |
| low | Per a FURS answer quoted in ib-edavki #94, an option that expires or is exercised into shares is not a disposal under ZDDOIFI, so no D-IFI entry arises; shares received on exercise are reported in Doh-KDVP when sold. | [ib-edavki #94](https://github.com/ib-edavki/ib-edavki/issues/94) |
| medium | Spot FX transactions are not derivatives under ZDDOIFI and are not reported in D-IFI (FURS wording quoted in ib-edavki #175). (04 §3 states the same rule, citing the FURS IFI brochure; it is not one of 04's verified critical claims.) | [ib-edavki #175](https://github.com/ib-edavki/ib-edavki/issues/175) |
| medium | Interest on deposits at Slovenian or other EU banks goes on Doh-DHO when the yearly total exceeds EUR 1,000; broker cash interest such as IBKR's goes on Doh-Obr; TaxBrokerReport treats Trade Republic interest from 2023-12-06 as bank-deposit interest. (Confirmed in [04 §8](04-si-tax-rules.md#8-interest), verified.) | [FURS - Prejel sem obresti](https://www.fu.gov.si/zivljenjski_dogodki_prebivalci/prejel_sem_obresti) |

Before any of this ships as code: parser fixtures derived from this survey must be validated against real (anonymized) exports, and every claim about eDavki behavior that comes only from an issue tracker should be treated as a hypothesis to test, not a rule.

## Open questions

- Should distributions from foreign UCITS ETFs and other investment funds be reported in Doh-Div with Type 4 (investment-fund profit distribution) instead of Type 1? Every surveyed tool uses 1. This needs confirmation from FURS or the furs-doh-div research doc. ([02 §4.1](02-furs-doh-div-and-others.md#41-type-dividend-type-šifra-vrste-dividend) recommends 4 for funds and ETFs, based on FURS's Q&A.)
- When a resident claims a credit for foreign withholding tax, must `Dividend/ReliefStatement` be filled? ib-edavki auto-fills it per country. An etoro-edavki user reported that FURS said by phone it is not needed. TaxBrokerReport leaves it empty unless a treaty exemption is claimed. (See [02 §6](02-furs-doh-div-and-others.md#6-foreign-tax-reliefstatement-and-treaties): FURS frames it as an exemption claim.)
- Is Doh-Div `PayerIdentificationNumber` still silently dropped on submission when it exceeds 12 characters? It was observed in 2023; the ib-edavki maintainer said in Feb 2025 that it is no longer limited.
- Does eDavki merge several `KDVPItem` inventory lists for the same ISIN/Code? Neophytez/t212-edavki writes one `KDVPItem` per transaction and users report it works after "Izračun". Does importing several Doh-KDVP XML files (e.g. one per broker) into one return merge per security or duplicate it? ([01 §9](01-furs-doh-kdvp.md#9-importing-into-edavki): PLVP and PLD lists that already exist are merged on import, PLVPGB lists are added; the merge key is unknown.)
- What effect, if any, does `Securities/IsFond=true` have for ETFs on eDavki's calculation? etoro-edavki sets it for ETFs; ib-edavki and the T212 tools always write false.
- Which form(s) apply to Revolut Savings (money-market fund units)? matevzpoljanc writes Doh-KDVP fund trades plus Doh-Obr Interest Type 7 with payer Revolut Securities Europe UAB. DavekNaDobiček routes money-market funds to Doh-Obr. (Answered in [04 §8](04-si-tax-rules.md#8-interest), verified from FURS Q18/Q18a: the Savings Flexible Account's fund interest goes on Doh-Obr at 25% with no EUR 1,000 allowance, and every fund-unit purchase, reinvestment and redemption also goes on Doh-KDVP, even at zero gain. Revolut Bank UAB's Instant Access Savings is deposit interest instead.)
- Is eDavki's automatic computation of the 30-day loss rule (F10, 97/2+5 ZDoh-2) reliable? Davkomat's FAQ says eDavki computes it incorrectly on the portal but the final FURS decision is correct. Should we write F10 or leave it empty?
- Does IBKR's Flex XML report pre-split trades with original or split-adjusted quantities? Open ib-edavki PRs #201 and #213 disagree.
- How should a split row in the Trade Republic CSV export (shares = added units or new total) be interpreted? TaxBrokerReport left it unresolved.
- Exact Doh-Obr Interest `Type` code list (ib-edavki uses 2 for IBKR interest; matevzpoljanc uses 7 for money-market fund income). Not verified from the FURS Doh-Obr instructions here; the furs-doh-div-and-others research should confirm it. (Answered in [02 §10](02-furs-doh-div-and-others.md#10-doh-obr-interest-doh_obr_2xsd): codes 1–12, and code 10 is for ex-officio returns only; verified.)
- Status of the proposed 25% crypto-gains tax and of the ZDDOIFI amendment proposed alongside it in July 2025. The crypto law was removed from the December 2025 agenda; its later status is unverified. ([04 §1](04-si-tax-rules.md#1-what-changed-in-2025-and-2026) and [§2.4](04-si-tax-rules.md#24-contrast-derivatives-under-zddoifi-filed-on-doh-ifi-not-doh-kdvp), verified: ZDDOIFI-B applies a flat 25% to derivatives from tax year 2026; crypto disposal gains outside a business stay untaxed in 2025 and 2026, but mining income and business trading are taxed. Tax year 2027 remains open.)
- Commercial service prices and broker lists change seasonally; recheck before publishing comparisons. No relevant med.over.net thread was confirmed.

## Sources

- [ib-edavki/ib-edavki (IBKR -> Doh-KDVP/D-IFI/Doh-Div/Doh-Obr)](https://github.com/ib-edavki/ib-edavki)
- [ib-edavki issue #42 - FURS rejects summed same-day dividends](https://github.com/ib-edavki/ib-edavki/issues/42)
- [ib-edavki issue #86 - PayerIdentificationNumber >12 chars dropped](https://github.com/ib-edavki/ib-edavki/issues/86)
- [ib-edavki issue #94 - option exercise/expiry and FURS answer](https://github.com/ib-edavki/ib-edavki/issues/94)
- [ib-edavki issue #163 - payer identification number discussion](https://github.com/ib-edavki/ib-edavki/issues/163)
- [ib-edavki issue #171 - FIFO across accounts](https://github.com/ib-edavki/ib-edavki/issues/171)
- [ib-edavki issue #175 - spot FX not a derivative](https://github.com/ib-edavki/ib-edavki/issues/175)
- [ib-edavki issue #176 - Doh-Obr element order error](https://github.com/ib-edavki/ib-edavki/issues/176)
- [ib-edavki issue #177 - uncovered corporate actions](https://github.com/ib-edavki/ib-edavki/issues/177)
- [ib-edavki issue #181 - position ISIN changed](https://github.com/ib-edavki/ib-edavki/issues/181)
- [ib-edavki issue #58 - CNH missing from BSI](https://github.com/ib-edavki/ib-edavki/issues/58)
- [ib-edavki PR #213 - ISIN-changing splits, F8 violations, C;O trades](https://github.com/ib-edavki/ib-edavki/pull/213)
- [masbug/etoro-edavki](https://github.com/masbug/etoro-edavki)
- [etoro-edavki issue #31 - Code maxLength 10](https://github.com/masbug/etoro-edavki/issues/31)
- [etoro-edavki issue #2 - DocumentWorkflowID required](https://github.com/masbug/etoro-edavki/issues/2)
- [etoro-edavki issue #46 - eToro removed ISIN column](https://github.com/masbug/etoro-edavki/issues/46)
- [Neophytez/t212-edavki](https://github.com/Neophytez/t212-edavki)
- [Neophytez/t212-edavki issue #22 - T212 header variants](https://github.com/Neophytez/t212-edavki/issues/22)
- [zvranesic/t212-edavki](https://github.com/zvranesic/t212-edavki)
- [TheCodeFighter/TaxBrokerReport](https://github.com/TheCodeFighter/TaxBrokerReport)
- [MarjanDB/brrr-generator](https://github.com/MarjanDB/brrr-generator)
- [Hafinator/LazyFURS](https://github.com/Hafinator/LazyFURS)
- [JakaCikac/revolut-edavki](https://github.com/JakaCikac/revolut-edavki)
- [matevzpoljanc/revolut-savings-account-tax-reports](https://github.com/matevzpoljanc/revolut-savings-account-tax-reports)
- [UnholyPhoenix/ibkr2dohkdvp (invented schema example)](https://github.com/UnholyPhoenix/ibkr2dohkdvp)
- [Bizyak13/etoro-furs (Doh-Div CSV)](https://github.com/Bizyak13/etoro-furs)
- [Ocepek-Domen/etoro_t212_edavki_merge](https://github.com/Ocepek-Domen/etoro_t212_edavki_merge)
- [FURS XSD Doh_KDVP_9](https://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd)
- [FURS XSD Doh_Div_3](https://edavki.durs.si/Documents/Schemas/Doh_Div_3.xsd)
- [FURS XSD D_IFI_4](https://edavki.durs.si/Documents/Schemas/D_IFI_4.xsd)
- [FURS XSD Doh_Obr_2](https://edavki.durs.si/Documents/Schemas/Doh_Obr_2.xsd)
- [FURS XSD Doh_DHO_4](https://edavki.durs.si/Documents/Schemas/Doh_DHO_4.xsd)
- [FURS XSD EDP-Common-1](https://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd)
- [Doh-KDVP form (MF-FURS obr. DOHKAP št. 4, UL RS 107/2025)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.i.sl.pdf)
- [Doh-KDVP instructions 2025](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf)
- [D-IFI form](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_ifi_20.i.sl.pdf)
- [D-IFI instructions](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_ifi_20.n.sl.pdf)
- [Doh-Div instructions](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div20.n.sl.pdf)
- [Doh-Div CSV prefill instructions](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_csv.n.docx)
- [BSI full-history exchange rate list](https://www.bsi.si/_data/tecajnice/dtecbs-l.xml)
- [FURS - Prejel sem obresti (interest, Doh-DHO threshold)](https://www.fu.gov.si/zivljenjski_dogodki_prebivalci/prejel_sem_obresti)
- [Davkomat](https://davkomat.si/)
- [Davkomat FAQ](https://davkomat.si/faq)
- [DavekNaDobiček](https://daveknadobicek.si/)
- [DavekNaDobiček cenik](https://daveknadobicek.si/cenik)
- [Plutko](https://plutko.si/)
- [eTeD / etoro-edavki.si](https://etoro-edavki.si/)
- [Pretvorba v eDavke (pricing)](https://pretvorba-edavki.si/)
- [edavki.rešitve.si XML generator service](https://edavki.xn--reitve-ckb.si/)
- [Portfelj](https://portfelj.net/)
- [taxesgobrrr.com (brrr-generator web UI)](https://taxesgobrrr.com/)
- [Slo-Tech forum - Etoro in Edavki](https://slo-tech.com/forum/t760618/199)
- [DavekNaDobiček blog - Kako izpolniti Doh-KDVP](https://daveknadobicek.si/blog/kako-izpolniti-doh-kdvp)
- [Plutko blog - Doh-KDVP 2025](https://plutko.si/blog/blog/vse-o-doh-kdvp-kapitalski-dobicki/)
- [Trading 212 e-davki (wixsite tool)](https://vemkajze.wixsite.com/trading212-davki)
- [csingley/ibflex](https://github.com/csingley/ibflex)
- [cgt-calc/capital-gains-calculator](https://github.com/cgt-calc/capital-gains-calculator)
- [dickwolff/Export-To-Ghostfolio](https://github.com/dickwolff/Export-To-Ghostfolio)
- [portfolio-performance/portfolio](https://github.com/portfolio-performance/portfolio)
- [pytr-org/pytr](https://github.com/pytr-org/pytr)
- [vaijira/burocratin](https://github.com/vaijira/burocratin)
- [KonvexInvestment/ibkr-steuer](https://github.com/KonvexInvestment/ibkr-steuer)
- [volodymyr-kovtun/Pitly](https://github.com/volodymyr-kovtun/Pitly)
- [Poslovni.si - crypto tax postponed](https://poslovni.si/novice/odlozen-davek-na-kriptovalute-slovenija-ostaja-kripto-oaza-se-vsaj-do-2027)
- [ZINR - Zakon o individualnih naložbenih računih (PISRS)](https://pisrs.si/pregledPredpisa?id=ZAKO9154)
