# Banka Slovenije (BSI) exchange rates for Slovenian tax filings

> Researched: 2026-10-07 · Verification: adversarially verified (20 claims: 20 confirmed, 0 refuted, 0 uncertain)
>
> Data snapshot: BSI rate lists through 2026-10-06. Research for building TaxReporter. It is not tax advice, and FURS publications and the law win over anything written here. Inline markers are explained in the [README](README.md#confidence-and-verification-legend).

## 1. TL;DR for implementers

- **Legal rule.** Every foreign-currency amount (income, foreign tax, acquisition value, disposal value, costs) is converted "po tečaju, ki ga objavlja Banka Slovenije", meaning at the rate published by Banka Slovenije that is valid on the day the income was earned, the asset was acquired or disposed of, or the cost arose. Sources: ZDoh-2 Art. 16(6), Art. 98(9), Art. 99(3). The wording has not changed since the original 2006 text (Uradni list RS 117/2006) (unverified — see Verification).
- **What BSI publishes.** BSI's "Dnevna tečajnica – referenčni tečaji ECB" is a copy of the ECB euro reference rates. Rates are quoted as **units of foreign currency per 1 EUR**, so `EUR = foreign_amount / rate`. The one exception is the precious metals on the monthly list, which are EUR per gram (§5) (corrected after verification).
- **Machine-readable sources:**
  - `https://www.bsi.si/_data/tecajnice/dtecbs.xml`: latest day only.
  - `https://www.bsi.si/_data/tecajnice/dtecbs-l.xml`: full history from 2007-01-01. 7,670,008 bytes raw, 677,808 bytes gzip-encoded.
  - `EksotTecBS.xml` and `EksotTecBS-l.xml`: monthly list of exotic currencies.
  - JSON API at `https://api.bsi.si/exchange/{daily,exotic}`.
- **CORS.** None of the BSI endpoints send `Access-Control-Allow-Origin`, so a browser-only app cannot read BSI directly. The ECB Data Portal API does send `Access-Control-Allow-Origin: *`, but only when the request carries an `Origin` header, which browsers always send (corrected after verification). So do GitHub Pages and raw.githubusercontent.com.
- **BSI matches ECB on 161,050 of 161,056 overlapping (date, currency) pairs.** Six values differ. One of them falls in tax year 2025: **NOK on 2025-10-23. BSI publishes 11.8529, the ECB publishes 11.5829.** That is a digit transposition and a 2.3% error.
- **Weekends and holidays.** BSI publishes only on TARGET days. BSI's own "show the rate list valid on day X" lookup returns the **last list published on or before X**: 2026-10-04 (Sunday) gives 2026-10-02, and 2026-01-01 gives 2025-12-31. FURS publishes no explicit rule, so treat this as medium confidence.
- **Changes in 2025/2026:**
  - BGN dropped off the daily list after 2025-12-31, because Bulgaria adopted the euro on 2026-01-01 at 1 EUR = 1.95583 BGN.
  - The monthly list replaced ANG with XCG on 2025-03-31.
  - BSI's database was migrated on 2025-01-29.
  - The 2025-12-31 list reached BSI's database only on 2026-01-02.

## 2. Legal basis: which rate FURS requires

| Provision | Text (Slovenian, verbatim) | Applies to |
|---|---|---|
| ZDoh-2 Art. 16(6) | "Pridobljeni dohodek in nastali stroški v tuji valuti se preračunajo v eure po tečaju, ki ga objavlja Banka Slovenije. Preračun se opravi po tečaju, ki velja na dan pridobitve dohodka oziroma nastanka stroškov, če ni s tem zakonom drugače določeno." | All income, including dividends (Doh-Div) |
| ZDoh-2 Art. 98(9) | "Nabavna vrednost in stroški v tuji valuti iz prvega odstavka tega člena se preračunajo v eure po tečaju, ki ga objavlja Banka Slovenije. Preračun se opravi po tečaju, ki velja na dan pridobitve kapitala oziroma na dan nastanka stroškov." | Doh-KDVP acquisition value |
| ZDoh-2 Art. 99(3) | "Vrednost kapitala ob odsvojitvi … v tuji valuti se preračunajo v eure po tečaju, ki ga objavlja Banka Slovenija. Preračun se opravi po tečaju, ki velja na dan odsvojitve kapitala oziroma na dan nastanka stroškov." | Doh-KDVP disposal value |

The "Banka Slovenija" typo in Art. 99(3) is in the source. The racunovodstvo.net consolidated text is marked "Velja od 11. 12. 2024, v uporabi od 1. 1. 2025". The only later entries are Constitutional Court decisions (UL 98/2025 and 107/2025). In the 2006 original the same sentence was Art. 98(8) (unverified — see Verification).

FURS form instructions repeat the rule:

- **Doh-Div** (`doh_odm_div.n.sl.pdf`) (corrected after verification). The PDF says, for the dividend: "…bruto znesek dividend v eurih, zaokrožen na dve decimalni mesti. Pridobljeni dohodek v tuji valuti se preračuna v eure po tečaju, ki ga objavlja Banka Slovenije in velja na dan pridobitve dividende." For the foreign tax: "…znesek tujega davka v eurih, zaokrožen na dve decimalni mesti. Znesek tujega davka v tuji valuti se preračuna v eure po tečaju, ki ga objavlja Banka Slovenije in velja na dan pridobitve dividende." The report originally quoted the wording "Če ste prejeli dividendo v drugi valuti, znesek preračunajte v EUR po tečaju, ki ga objavlja Banka Slovenije in je veljal na datum prejema dividende"; that wording is presumably from the HTML help (`NavodiloZaNapovedDiv.html`), which the verifier did not check. Either way:
  - **Foreign withholding tax is converted at the rate of the dividend date**, not the date the tax was withheld.
  - The date is the day the dividend is obtained (paid or received), which can differ from the broker's ex-date or record date. Parsers must take the payment date, not the ex-date, as the rate date.
  - Amounts are rounded to 2 decimals.
- **Doh-KDVP** (`doh_odm_kdvp.n.sl.pdf`, `doh_odm_kdvp_25.n.sl.pdf`): "Nabavna vrednost v tuji valuti se preračuna v eure po tečaju, ki ga objavlja Banka Slovenije. Preračun se opravi po tečaju, ki velja na dan pridobitve kapitala." The disposal value uses the rate of the disposal day. Acquisition and disposal are therefore converted **separately**, so FX movement becomes part of the gain.
- **D-IFI (derivatives)** FURS guidance (`Obdavcitev_dobicka_od_odsvojitve_izvedenih_financnih_instrumentov.docx`) is the most explicit: "…preračuna v eure po **referenčnem tečaju Evropske centralne banke, ki ga objavlja Banka Slovenije** … na dan sklenitve posla (referenčni tečaj ECB)." This is derivatives guidance; it does not directly govern Doh-KDVP or Doh-Div (corrected after verification).
- The OPSI metadata for the BSI dataset lists ZDoh-2 as one of its legal bases. It also states: "Dnevni devizni tečaji se prevzemajo iz spletne strani ECB" (daily rates are taken from the ECB website).

The statute names **BSI** as the publisher, not the ECB. This matters wherever the two differ (§8).

## 3. Inventory of machine-readable BSI sources

| Source | URL | Content | Size (2026-10-07) | Range |
|---|---|---|---|---|
| Daily, latest | `https://www.bsi.si/_data/tecajnice/dtecbs.xml` | One `<tecajnica>` (latest TARGET day) | 1,589 B | latest day |
| Daily, full history | `https://www.bsi.si/_data/tecajnice/dtecbs-l.xml` | All daily lists | 7,670,008 B (gzip on the wire: 677,808 B) | 2007-01-01 … today (5,060 lists) |
| Monthly exotic, latest | `https://www.bsi.si/_data/tecajnice/EksotTecBS.xml` | 126 currencies plus metals and XDR | 6,084 B | latest month |
| Monthly exotic, history | `https://www.bsi.si/_data/tecajnice/EksotTecBS-l.xml` | All monthly lists | 1,422,522 B | 2006-12-29 (valid from 2007-01-01) … today (248 elements) |
| XSD daily | `https://www.bsi.si/_data/tecajnice/DtecBS.xsd` | Schema, one `tecajnica` | 1,631 B | n/a |
| XSD history | `https://www.bsi.si/_data/tecajnice/DtecBS-l.xsd` | Schema, `maxOccurs="unbounded"` | n/a | n/a |
| XSD monthly | `EksotTecBS.xsd`, `EksotTecBS-l.xsd` (same directory) | Adds `veljavnost` | n/a | n/a |
| JSON API, daily | `https://api.bsi.si/exchange/daily` | Same data as the XML | ~384 KB for a full year | 2007-01-02 onward (the API omits the synthetic 2007-01-01 list) |
| JSON API, monthly | `https://api.bsi.si/exchange/exotic` | Monthly list with `valid_from` | n/a | n/a |
| PxWeb (tolar era) | `https://px.bsi.si/api/v1/sl/serije_slo/90_devizni_tecaji/10_devizni_tecaji_tolarja` | SIT rates 1991–2006 (`I2_10_2S.px` daily) | n/a | 1991–2006, CORS `*` |

The landing pages are `https://www.bsi.si/sl/statistika/devizni-tecaji` (link labels "Prenos zadnjih podatkov" and "Prenos časovnih serij") and `https://www.bsi.si/en/statistics/exchange-rates`. API documentation is at `https://www.bsi.si/sl/api-dokumentacija` and `https://www.bsi.si/en/api-documentation`.

## 4. XML format (daily and history)

The daily file in full (whitespace added; the real file is one line):

```xml
<?xml version="1.0"?><DtecBS xmlns="http://www.bsi.si"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.bsi.si http://www.bsi.si/_data/tecajnice/DTecBS.xsd">
  <tecajnica datum="2026-10-06">
    <tecaj oznaka="USD" sifra="840">1.1269</tecaj>
    <tecaj oznaka="GBP" sifra="826">0.84880</tecaj>
    <tecaj oznaka="AUD" sifra="036">1.6140</tecaj>
    ...
  </tecajnica>
</DtecBS>
```

- **Root element:** `DtecBS` (capital D, lowercase t). The **default namespace is `http://www.bsi.si`**, so namespace-aware parsers must look up `{http://www.bsi.si}tecajnica`.
- **`tecajnica`:** has the attribute `datum` (`xsd:date`, `YYYY-MM-DD`). This is the ECB reference date. The history file contains many `tecajnica` elements, in ascending date order with no duplicates.
- **`tecaj`:** has the attributes `oznaka` (ISO 4217 alpha code, XSD pattern `[A-Z]{3}`) and `sifra` (ISO 4217 numeric code, kept as a **3-character string with leading zeros**, pattern `\d{3}`, for example `"036"`). The element text is an `xsd:decimal`.
- **Number format:** `.` as the decimal separator, no thousands separator. Trailing zeros are kept exactly as the ECB publishes them (`0.84880`, `20104.80`). The HTML pages show Slovenian commas (`1,1269`), so never scrape the HTML.
- **Encoding:** the XML declaration has no encoding attribute. The content is pure ASCII on a single line with no line terminators.
- **Schema location bug:** `xsi:schemaLocation` points to `DTecBS.xsd` (and `DTecBS-l.xsd`), which end in **HTTP 404**: the server first answers 302 to `https://www.bsi.si/en/_data/tecajnice/DTecBS.xsd`, and that URL returns 404. The real files are `DtecBS.xsd` and `DtecBS-l.xsd`, because the server is case-sensitive. All four downloaded XML files validate with `xmllint --nonet --schema` against the correctly named XSDs.
  - **Case-insensitive filesystems** (corrected after verification). `DtecBS.xsd` and `DTecBS.xsd` differ only in case, so on macOS (default) and Windows a file or cache entry saved under one name silently overwrites the other. The verifier's first download of the real XSD was overwritten by the redirect HTML this way. Store vendored XSDs under names that cannot collide.
- **Daily vs. latest ECB XML:** for 2026-10-06 the rate strings in BSI's file are identical to the ECB's `eurofxref-daily.xml`. Only the currency order differs (BSI lists ISK before CHF).
- **Synthetic first list:** the history contains a list dated **2007-01-01**, the day Slovenia adopted the euro. That day was a TARGET holiday, and the ECB published no rates. BSI's 2007-01-01 values equal the ECB's 2006-12-29 values for all 34 currencies.

### Decimals per currency (constant over the whole history)

The `stDec` field in BSI's web data confirms these counts:

| Decimals | Currencies |
|---|---|
| 2 | JPY, HUF, ISK, IDR, KRW |
| 3 | CZK, PHP, THB (also SKK) |
| 4 | USD, DKK, PLN, RON, SEK, CHF, NOK, TRY, AUD, BRL, CAD, CNY, HKD, ILS, INR, MXN, MYR, NZD, SGD, ZAR, BGN, RUB, HRK, LVL, EEK, MTL, LTL (16 LTL lists have 5) |
| 5 | GBP |
| 6 | CYP |

### Currency coverage of `dtecbs-l.xml` (38 codes)

- **Current list (29 currencies, since 2026-01-01):** USD 840, JPY 392, CZK 203, DKK 208, GBP 826, HUF 348, PLN 985, RON 946, SEK 752, ISK 352, CHF 756, NOK 578, TRY 949, AUD 036, BRL 986, CAD 124, CNY 156, HKD 344, IDR 360, ILS 376, INR 356, KRW 410, MXN 484, MYR 458, NZD 554, PHP 608, SGD 702, THB 764, ZAR 710.
- **Late starters:** BRL and MXN from 2008-01-02, INR from 2009-01-02, ILS from 2011-01-03.
- **ISK gap** (corrected after verification): the last ISK observation before the gap is 2008-12-09, so ISK is missing from 2008-12-10; it returns on 2018-02-01. ISK has 2,719 observations in total. For the gap period, use the monthly list.
- **Discontinued currencies (last date):**

| Code | Last date | Reason |
|---|---|---|
| BGN | 2025-12-31 (1.9558) | Euro from 2026-01-01 at 1.95583 |
| RUB | 2022-03-01 (117.2010) | ECB suspended the rate |
| HRK | 2022-12-30 | Euro, fixed rate 7.53450 |
| LTL | 2014-12-31 | Euro |
| LVL | 2013-12-31 | Euro |
| EEK | 2010-12-31 | Euro |
| SKK | 2008-12-31 | Euro |
| CYP, MTL | 2007-12-31 | Euro |

Lists per year: 2025 has 255 lists. 2026 has 195 lists through 2026-10-06.

## 5. Monthly exotic-currency list (`EksotTecBS*.xml`)

- **Root element:** `EksotTecBS`, in the same namespace. Each `tecajnica` has two required attributes:
  - `datum`: the date the rates were taken. This is BSI's last working day of the month on the Slovenian calendar. For example, it was 2025-10-30 because 31 October is a Slovenian holiday.
  - `veljavnost`: always the 1st of the following month.
- **Example:** `<tecajnica datum="2026-09-30" veljavnost="2026-10-01">`.
- **BSI's description:** "Banka Slovenije tečaje in cene objavi popoldne zadnjega delovnega dne v mesecu. Prikazani so pod naslednjim mesecem, npr. vnos 14. 8. 2008 v iskalnik vrne tečajnico z datumom 1. 8. 2008, ki vsebuje devizne tečaje 31. 7. 2008." In English: a date anywhere in month M maps to the list with `veljavnost` = the 1st of M.
- **Content:** 126 codes in the latest list, including **TWD (901)** and **ARS (032)**, plus AED, SAR, VND, UAH, KZT, CLP, COP, PEN, EGP, NGN, PKR, QAR, KWD, RSD, BAM, MKD, ALL and others. The list also carries the metals XAU, XAG, XPT and XPD, which are **EUR per gram, not currency per EUR** ("Cene plemenitih kovin so izražene v evrih za 1 gram kovine"), and XDR. A generic divide-by-rate converter must exclude the metals, or reject them as transaction currencies (corrected after verification).
- **No RUB** at any time. BYN ran only from 2016-06-30 to 2022-02-28.
- **Parser gotcha:** ten months in 2008–2009 have **two `tecajnica` elements with the same `datum`/`veljavnost`**. One holds a single renamed currency (for example ZWR, TMM) and the other the rest. **Merge them; do not overwrite.**
- **TWD values (`veljavnost`: rate)** (corrected after verification): 2025-01-01: 34.074 (datum 2024-12-31); 2025-02-01: 33.971; 2025-07-01: 34.248; 2025-08-01: 34.197; 2026-01-01: 36.917. The original report listed 36.917 for 2025-01-01 as well; that value belongs to 2026-01-01 only.
- **JSON API pitfall:** the API's monthly endpoint filters by the list's `datum`, not by `valid_from`, so it returns the wrong month for this rule (§6).

## 6. BSI JSON API (`api.bsi.si`)

The API is documented at `/sl/api-dokumentacija`. It has five endpoints: `/inflation`, `/interests`, `/exchange/daily`, `/exchange/exotic` and `/exchange/client`.

- **Parameters:**
  - `code=USD`
  - `date=2025` (whole year), `date=2025-10` (month) or `date=2025-10-10` (one day)
  - Ranges: `date[from]=…&date[to]=…`. URL-encode the brackets as `%5B` and `%5D`.
- **Response:**
  ```json
  {"success":true,"error":null,"type":"data","message":null,
   "data":[{"code":"USD","date":"2025-12-31","value":1.175}, ...]}
  ```
  Exotic rows add `valid_from`.
- **Exotic date filter** (corrected after verification). `/exchange/exotic?date=YYYY-MM` filters on the `date` field, which is the list's `datum` (the last working day of that month), not on `valid_from`. For example, `code=TWD&date=2025-07` returns `date` 2025-07-31 / `valid_from` 2025-08-01 / 34.197. Under BSI's own "shown under the following month" rule, July 2025 should use 34.248 (`valid_from` 2025-07-01). Select monthly rows by `valid_from`.
- **Values are JSON numbers.** Trailing zeros are lost (0.8726, where the XML has 0.87260). In JavaScript, `JSON.parse` produces IEEE doubles; BSI's own web payload shows `1.1360000000000001`. Parse with a decimal-preserving parser, or use the XML.
- **No lookback.** A weekend date returns `"data":[]`. A malformed date returns `{"success":false,"error":"Date mismatch",…}`.
- **Order** (corrected after verification). Date-range queries return rows in **descending** date order, while the XML is ascending. Code that assumes ascending order (for example "take the last element ≤ D") picks the wrong row.
- **Headers:** `cache-control: no-cache, private`, `x-ratelimit-limit: 60`. The time window of that limit is not documented, and the API documentation does not mention the limit at all, so "per minute" is an assumption (corrected after verification).
- **Consistency:** a full-year query for 2025 returned 7,650 rows (255 days × 30 currencies), identical to the XML.

## 7. Publication timing and calendar

- **Official statements:**
  - BSI: "Banka Slovenije objavlja tečajnico praviloma po 16.15 vsak TARGET delovni dan … Devizni tečaji nimajo predpisanega obdobja veljave." The English page says: "The exchange rates are published soon after 16:15 on every TARGET working day."
  - ECB: rates are "usually updated at around 16:00 CET every working day, except on TARGET closing days", based on a concertation "around 14:10 CET". They are published "for information purposes only".
  - Before 1 July 2016, BSI published at 14:40 (BSI press release, 7 December 2015).
- **Observed:**
  - On 2026-10-06 the ECB files have `Last-Modified 13:56 GMT` and BSI's XML has `13:58 GMT`, both just before 16:00 Slovenian time.
  - BSI's database `created_at` stamps are consistently 13:58 in summer and 14:58 in winter, which is 15:58 local time if the stamps are UTC. That they are UTC is inferred, not documented (corrected after verification).
  - **The 2025-12-31 list was inserted on 2026-01-02 08:47 UTC.**
  - All rows before 2025 carry `created_at 2025-01-29 10:26:18`, which points to a database migration on that date.
  - BSI's notes record a 90-minute delay on 2023-09-21 and corrections that followed ECB corrections (2015-05-25 GBP, 2015-11-03 MXN, 2017-07-17 GBP/SEK/HRK/IDR/ZAR).
- **TARGET closing days with no list:**
  - 2024: Jan 1, Mar 29, Apr 1, May 1, Dec 25, Dec 26
  - 2025: Jan 1, Apr 18, Apr 21, May 1, Dec 25, Dec 26
  - 2026: Jan 1, Apr 3, Apr 6, May 1, Dec 25 (Dec 26 is a Saturday)
- **BSI does publish on Slovenian-only holidays** (for example 25 June, 15 August, 31 October), because its dates equal the ECB's. The longest gaps are Easter (Thursday to Tuesday) and Christmas (for example 2025-12-24 to 2025-12-29).

## 8. Are BSI rates identical to ECB reference rates?

**Method.** The comparison parsed `dtecbs-l.xml` and the ECB `eurofxref-hist.csv` (inside `eurofxref-hist.zip`, history from 1999-01-04), then compared **every** overlapping (date, currency) pair as `Decimal` values. A full ECB Data Portal SDMX extract (`EXR/D..EUR.SP00.A`, from 2006-12-01, 10.2 MB CSV) was used as a third source.

**Coverage results:**

- Date sets are identical, apart from BSI's synthetic 2007-01-01 list.
- Neither source has dates the other lacks in the range.
- 161,056 common pairs.
- 29,127 pairs differ only in string form (the ECB history CSV strips trailing zeros).
- **6 pairs differ numerically.**

**The six discrepancies:**

| Date | Ccy | BSI (XML = API = web) | ECB CSV | ECB SDMX | Assessment |
|---|---|---|---|---|---|
| 2008-10-14 | JPY | 141.52 | 141.25 | 141.25 | BSI digit transposition |
| 2010-03-04 | HUF | 266.02 | 266.5 | 266.5 | BSI repeated the previous day's value |
| 2013-06-24 | BGN | 1.9560 | 1.9558 | **1.956** | ECB's own two outputs disagree; BSI matches SDMX |
| 2013-12-31 | LVL | 0.7028 | 0.702804 | 0.702804 | BSI truncated the fixed conversion rate |
| 2014-02-03 | SGD | 1.7341 | 1.7212 | 1.7212 | BSI wrong |
| **2025-10-23** | **NOK** | **11.8529** | **11.5829** | **11.5829** | BSI digit transposition. Norges Bank's 14:15 CET fixing that day was 11.583; neighboring ECB days were 11.643 and 11.6185. |

The Frankfurter ECB mirror agrees with the ECB on all six. BSI's notes mention no correction for any of them.

**Random sample.** 40 pairs were drawn with seed 20261007, and all 40 were numerically equal. The first 30:

| Date | Ccy | BSI | ECB |
|---|---|---|---|
| 2007-01-30 | LTL | 3.4528 | 3.4528 |
| 2007-03-05 | CZK | 28.188 | 28.188 |
| 2007-07-05 | THB | 42.284 | 42.284 |
| 2008-03-14 | SKK | 32.302 | 32.302 |
| 2008-06-06 | THB | 51.688 | 51.688 |
| 2008-06-19 | GBP | 0.78630 | 0.7863 |
| 2008-10-01 | MXN | 15.3976 | 15.3976 |
| 2009-04-27 | RUB | 43.8650 | 43.865 |
| 2009-08-27 | CHF | 1.5234 | 1.5234 |
| 2010-02-04 | DKK | 7.4446 | 7.4446 |
| 2010-02-09 | PHP | 63.836 | 63.836 |
| 2010-02-24 | NZD | 1.9588 | 1.9588 |
| 2010-05-13 | DKK | 7.4388 | 7.4388 |
| 2010-08-31 | HUF | 287.68 | 287.68 |
| 2010-12-03 | LVL | 0.7097 | 0.7097 |
| 2012-02-01 | NOK | 7.6540 | 7.654 |
| 2012-05-25 | LTL | 3.4528 | 3.4528 |
| 2012-11-01 | SGD | 1.5830 | 1.583 |
| 2013-01-18 | INR | 71.7440 | 71.744 |
| 2013-07-24 | MYR | 4.2222 | 4.2222 |
| 2014-01-10 | SEK | 8.8820 | 8.882 |
| 2014-03-24 | CNY | 8.5320 | 8.532 |
| 2015-03-19 | RUB | 64.1691 | 64.1691 |
| 2015-09-16 | HRK | 7.5740 | 7.574 |
| 2016-01-29 | CAD | 1.5363 | 1.5363 |
| 2016-11-15 | RON | 4.5140 | 4.514 |
| 2017-08-09 | ILS | 4.2207 | 4.2207 |
| 2018-03-01 | MYR | 4.7814 | 4.7814 |
| 2018-06-05 | IDR | 16208.40 | 16208.4 |
| 2022-01-03 | CHF | 1.0372 | 1.0372 |

**SDMX caveat.** The ECB SDMX series `EXR.D.*.EUR.SP00.A` also contains observations that are *not* in the reference list, and therefore not in BSI's list:

- TWD, ARS, DZD and MAD until 2020-10-30
- BRL and MXN during 2007, INR during 2007–2008, ILS during 2007–2010

An ECB fallback must be limited to the currencies and dates that BSI's own list covers.

**Recommendation.** By statute, BSI's published value is the legal reference. Default to the BSI value. Show a non-blocking warning, with the ECB value, whenever a transaction falls on a known discrepancy (NOK 2025-10-23 matters for TY2025), and let the user override it. Report the errors to BSI.

## 9. Weekends, holidays and TARGET closing days

Neither ZDoh-2 nor the FURS instructions say what to do when no list exists for the day. The available evidence:

1. **BSI states rates have no prescribed validity period.** The phrase is "nimajo predpisanega obdobja veljave"; the English page says "the hour of the validity is not stated".
2. **BSI's own lookup ("Prikaži tečajnico z veljavnostjo na dan")**, queried through its Livewire endpoint, returns the **most recent list on or before the requested day**:

| Requested day | List returned |
|---|---|
| 2026-10-04 (Sunday) | 2026-10-02 |
| 2025-12-25 | 2025-12-24 |
| 2026-01-01 | 2025-12-31 |
| 2025-04-18 and 2025-04-21 | 2025-04-17 |
| 2025-05-01 | 2025-04-30 |
| 2026-10-07 (before publication) | 2026-10-06 |

3. **Prior art:** the open-source `ib-edavki` (`getCurrencyRate`) uses the same-day rate and otherwise walks back up to 9 days.

**Rule to implement:** `rate(D, C)` = the value of C in the list with the greatest `datum` ≤ D that contains C. Cap the lookback at 7 days and treat anything longer as an error. Confidence is medium; see the open questions. The longest real gaps between consecutive daily lists (§7: Easter, Thursday to Tuesday; Christmas, e.g. 2025-12-24 to 2025-12-29) are 5 calendar days, so a lookback across a calendar gap never exceeds 4 days. Hitting the 7-day cap means the data is missing, or the currency is not on the daily list for that period (for example ISK in 2008–2018), in which case the monthly list applies (§10).

When D is a TARGET day, use D's own list even if the transaction happened before 16:00. If that list is not yet published, mark the result provisional instead of falling back.

## 10. Currencies not on the daily list

- **TWD, ARS and other exotic currencies:** these are on BSI's monthly list, which is still "published by Banka Slovenije". Use the list whose `veljavnost` is the greatest value ≤ D (that is, the 1st of D's month). BSI also says ISK for 2008-12 to 2018-01 is on the monthly list. Confidence: medium-high.
- **RUB after 2022-03-01, BYN after 2022-04-01:** BSI publishes **no** rate. BSI's notes redirect users to the European Commission's **InforEuro** monthly accounting rates ("Tečaj za obdobje po 1. 3. 2022 je na voljo na strani Evropske komisije, Devizni tečaj (InforEuro)"). Those are "the market rates for the second to last day of the previous month as quoted by the ECB" or from other sources; for example, RUB for 2025-10 is 97.5654. FURS has published no income-tax guidance on this. Treat InforEuro as a fallback that needs explicit user confirmation and a warning (low confidence). FURS publishes a separate RUB rate for *customs* valuation, which does not apply to income tax.
- **Broker pseudo-currencies:** GBX/GBp (pence) = GBP/100, ZAc = ZAR/100, ILA = ILS/100. These are arithmetic identities. **CNH** (offshore yuan, used by IBKR) has no BSI rate; `ib-edavki` maps it to CNY. That mapping is pragmatic and has no legal confirmation (low confidence).
- **Euro changeover currencies:** amounts after a changeover convert at the irrevocable rates. BGN: 1.95583 (from 2026-01-01). HRK: 7.53450 (from 2023-01-01). Earlier: LTL 3.45280, LVL 0.702804, EEK 15.6466, SKK 30.1260, CYP 0.585274, MTL 0.429300.
- **Pre-2007 tolar-era acquisitions:** these are mostly irrelevant, because Doh-KDVP reports only lots disposed of within 15 years of acquisition (unverified — see Verification; since verified in [04 §5.4](04-si-tax-rules.md#54-losses-on-exempt-disposals), and the Doh-KDVP instructions quoted in [01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing) say the same). BSI's PxWeb has SIT rates for 1991–2006 if needed.

## 11. HTTP behavior and CORS (tested 2026-10-07, `curl -sI -H 'Origin: http://localhost:5173'`)

| Endpoint | `Access-Control-Allow-Origin` | Caching headers | Notes |
|---|---|---|---|
| bsi.si `dtecbs.xml`, `dtecbs-l.xml`, `EksotTecBS*.xml` | **absent** (also absent on `OPTIONS`, which answers `allow: OPTIONS,HEAD,GET,POST`) | `Last-Modified`, `ETag: W/"…-gzip"`, no `Cache-Control` or `Expires` | Served by Cloudflare (`cf-cache-status: DYNAMIC`). `content-type: application/xml`. gzip on request. **`If-Modified-Since` returns 304**; `If-None-Match` was not honored (200). |
| api.bsi.si | **absent** | `cache-control: no-cache, private` | `x-ratelimit-limit: 60` |
| ECB `eurofxref-daily.xml`, `eurofxref-hist.zip` | **absent** | `cache-control: max-age=300`, `Last-Modified` | Zip is 640,609 B; CSV inside is 1,925,198 B with a trailing comma on each row and `N/A` for missing values |
| ECB Data Portal `data-api.ecb.europa.eu/service/data/EXR/D.{CUR}.EUR.SP00.A?format=csvdata` | **`*`**, but only when the request carries an `Origin` header (corrected after verification) | `cache-control: max-age=30` | Also `format=jsondata` and `detail=dataonly` |
| raw.githubusercontent.com, GitHub Pages | **`*`** | `max-age=300` / `600` | Suitable for hosting a mirrored snapshot |

A CI job that checks these CORS headers must send an `Origin` header, or the ECB Data Portal will look as if it has no CORS (corrected after verification).

## 12. Licensing for bundling rate data in an AGPL repository

- **BSI "Pogoji uporabe" / "Disclaimer and copyright":**
  - BSI holds copyright but "dovoljuje shranjevanje, reprodukcijo in distribucijo datotek in informacij … pod pogojem, da je vidno označen vir podatkov in da ostanejo podatki nespremenjeni".
  - Any modification must be stated explicitly.
  - Reproduction "za namen izvajanja tržnih in oglaševalskih dejavnosti" needs prior consent.
  - Paid products must tell buyers the data is free on bsi.si.
  - BSI disclaims accuracy.
- **ESCB reuse policy** (ECB page; BSI is an ESCB national central bank): "All publicly available ESCB statistics may be reused free of charge on the condition that the source is quoted (e.g. 'Source: ECB statistics.') and that the statistics … are not modified", "irrespective of any subsequent commercial or non-commercial use".
- **ECB copyright notice:** free use with accurate reproduction and citation, the same paid-product notice, and modifications must be stated.
- **OPSI (podatki.gov.si):** the dataset "Dnevna in mesečna devizna tečajnica Banke Slovenije" lists no special reuse conditions and no license ID.
- **InforEuro:** "strictly informative … intended only for the purpose of the implementation of the EU budget … does not give users any rights". Do **not** bundle it; fetch it on demand and attribute it.

**Practical upshot.** Bundling BSI and ECB rates is allowed. Ship them under a separate `DATA-NOTICE` (not AGPL), with "Source: Banka Slovenije (ECB reference rates)". Keep values byte-identical to the source strings. State any format conversion ("converted from dtecbs-l.xml; values unchanged"). Apply the known-discrepancy warnings at runtime rather than editing the bundled data. (The verifier confirmed the license texts; this is not legal advice.)

## 13. Recommended implementation

**Snapshot pipeline (CI, scheduled weekdays around 16:45 CET, plus manual runs):**

1. Fetch `dtecbs-l.xml` and `EksotTecBS-l.xml` with `If-Modified-Since`.
2. Parse with a DTD-free, XXE-safe parser (for example `defusedxml`). Validate against `DtecBS-l.xsd` and `EksotTecBS-l.xsd`, stored in the repo under names that cannot collide case-insensitively with the `DTecBS*.xsd` names in `schemaLocation` (corrected after verification).
3. Check invariants:
   - dates ascending and unique
   - no weekend dates
   - each currency's decimal count unchanged
   - the date set equals ECB's (allowing for 2007-01-01)
4. Cross-check against the ECB SDMX extract. **Fail CI on any discrepancy not already in `known-discrepancies.json`**, which currently holds the six pairs above.
5. Emit a compact snapshot: CSV with the original decimal strings, one column per currency. From 2007 this is about 1.26 MB, or 470 KB gzip. From 2010, which covers the 15-year window, it is about 1.05 MB, or 396 KB gzip. Record the source `Last-Modified` and a SHA-256.

**Runtime:**

- **Browser:** the app cannot call BSI because there is no CORS. Use the bundled snapshot first. For dates after it, fetch the project's mirrored snapshot (GitHub Pages or raw.githubusercontent.com, CORS `*`). As a last resort use the ECB Data Portal API, labeled "ECB reference rate, BSI copy not verified", and only for the currency set BSI's list covers on that date.
- **CLI or desktop:** fetch BSI directly.

**Lookup and conversion:**

```text
rate(D, C):
  if C == "EUR": return 1
  if C in {XAU, XAG, XPT, XPD}: ERROR  # metals are EUR per gram, not units per EUR (corrected after verification)
  C, factor = normalize(C)            # GBX->(GBP,100), ZAc->(ZAR,100), ILA->(ILS,100)
  if C in euro_changeover and D >= changeover[C]: return fixed[C] * factor
  L = daily list with max datum <= D containing C  (lookback <= 7 days)
  if D is a TARGET day and L.datum < D: mark PROVISIONAL (not yet published)
  if none: M = monthly list with max veljavnost <= D containing C   # by valid_from in the API, never by date (§6)
  if none: ERROR -> user-supplied rate (e.g. InforEuro for RUB), flagged
  warn if (L.datum, C) in known_discrepancies
  return Decimal(value) * factor
EUR = Decimal(amount) / rate        # round to 2 dp only at the final form field
```

The Doh-Div foreign tax uses the **dividend date's** rate. The Doh-KDVP acquisition and disposal each use their own date's rate.

**Tests to write:**

- weekend, Easter, Christmas and New Year lookbacks
- the 2007-01-01 list
- ISK in the 2008–2018 gap (monthly)
- BGN on 2026-01-02
- RUB on 2022-03-02 (error path)
- the duplicate monthly `tecajnica` merge
- the NOK 2025-10-23 warning
- trailing-zero preservation
- monthly selection by `veljavnost`: TWD for July 2025 is 34.248, not the 34.197 the API's `date=2025-07` filter returns (corrected after verification)

## Verification

An independent verifier re-downloaded the XSDs, the full history and monthly files, the JSON API responses, the ECB history and SDMX data, the law texts and the FURS instructions, replayed BSI's website lookup, and re-ran the full BSI-vs-ECB comparison (same 161,056 pairs, same 6 differences). All 20 critical claims were confirmed.

**Claims not confirmed:** none of the 20 critical claims. Two sub-points the verifier could not check, and two errors it found in the report body, are listed below and marked inline.

**Missed items** (facts the verifier found that the report lacked or got wrong; each is applied inline where noted):

- **Select monthly API rows by `valid_from`.** `/exchange/exotic?date=YYYY-MM` filters on the list's `datum`, so `code=TWD&date=2025-07` returns the list valid from 2025-08-01 (34.197) instead of July's 34.248. Applied in §5, §6 and §13.
- **Report error, TWD:** the value for `veljavnost` 2025-01-01 is 34.074 (datum 2024-12-31), not 36.917, which belongs to 2026-01-01. Applied in §5.
- **Report error, ISK gap:** ISK is missing from 2008-12-10 (last observation 2008-12-09), not from 2008-12-04, and returns on 2018-02-01; the 2,719 total is correct. Applied in §4.
- **Exclude the metals.** XAU, XAG, XPT and XPD on the monthly list are EUR per gram, the opposite direction from currency rates; a divide-by-rate converter must reject them. Applied in §1, §5 and §13.
- **Send `Origin` when testing CORS.** The ECB Data Portal returns `Access-Control-Allow-Origin: *` only for requests with an `Origin` header (browsers always send one); a curl test without it shows no header. Applied in §1 and §11.
- **Avoid case-only filename collisions.** `DtecBS.xsd` (real) and `DTecBS.xsd` (404 name in `schemaLocation`) collide on macOS and Windows filesystems; store vendored XSDs under distinct names. Applied in §4 and §13.
- **API range results are descending.** The JSON API returns date ranges newest first, while the XML is oldest first; never assume ascending order. Applied in §6.
- **Use the payment date for dividends.** The Doh-Div PDF says "velja na dan pridobitve dividende" (the day the dividend is obtained), which can differ from the ex-date or record date. Applied in §2.
- **15-year cutoff not verified here.** The claim in §10 that Doh-KDVP reports only lots disposed of within 15 years of acquisition is outside this topic. Since the 2020 ZDoh-2 rate schedule, holdings over 15 years are taxed at 0%; check separately whether such disposals must still be reported before relying on a pre-2010 rate cutoff. (The Doh-KDVP navodila quoted in [01](01-furs-doh-kdvp.md) say column 1 starts with the first acquisition of a security "ki je bil odsvojen pred potekom petnajstih let od dneva pridobitve", and the [04](04-si-tax-rules.md#54-losses-on-exempt-disposals) verification has since confirmed that only lots disposed of within 15 years are listed; losses on exempt disposals do not reduce the base, art. 96(3).) Marked in §10.

**Qualifications on confirmed claims** (verifier notes that refine a confirmed claim):

- *Art. 16(6) (§1, §2):* the current consolidated text is confirmed verbatim, but the verifier could not retrieve the 2006 original, so "unchanged since 117/2006" (and "Art. 98(8) in 2006") is low confidence. It does not affect a filing. Marked inline.
- *Doh-Div wording (§2):* the PDF's wording differs from the quote in the original report, with the same meaning. Applied inline.
- *D-IFI guidance (§2):* it governs derivatives, not Doh-KDVP or Doh-Div directly. Applied inline.
- *Units per EUR (§1):* exception for metals. Applied inline.
- *XSD structure (§4):* `Tsif` is `xsd:string` length 3 with pattern `\d{3}`; `Tozn` length 3 with `[A-Z]{3}`; `tecaj` extends `xsd:decimal`; `datum` is a required `xsd:date`; the daily XSD has `tecajnica maxOccurs=1` and the `-l` variant unbounded. `dtecbs.xml`, `dtecbs-l.xml` and `EksotTecBS-l.xml` all validate with `xmllint --nonet`.
- *Lookup behavior (§9):* the replayed lookup also returned USD 1,1225 for 2.10.2026. It is BSI website behavior, not a legal rule, and no FURS written rule was found.
- *Discrepancies (§8):* the count holds for the snapshot as of 2026-10-06; BSI could correct values later.
- *Monthly list (§10):* that the monthly list is the legally correct source for exotic currencies is an inference (medium confidence).
- *Rate limit (§6):* the limit appears only in the response header; its window is undocumented. Applied inline.
- *Schema location (§4):* `DTecBS.xsd` first redirects (302) and then returns 404. Applied inline.
- *Timestamps (§7):* `created_at` being UTC is inferred. Applied inline.
- *RUB (§10):* whether FURS accepts InforEuro is unconfirmed.
- *Licensing (§12):* license texts confirmed verbatim; not legal advice.

## Open questions

- FURS publishes no explicit rule for transactions or dividends dated on weekends, holidays or TARGET closing days. The "last published rate on or before the day" rule rests on BSI's own lookup behavior and common practice (ib-edavki). It should be confirmed with FURS (e.g. a written question via eDavki).
- For the six BSI-vs-ECB discrepancies, and especially NOK on 2025-10-23 (BSI 11.8529 vs ECB 11.5829), which value would FURS accept or expect? Did the ECB originally publish 11.8529 and later correct it (Wayback Machine was rate-limited and could not be checked)? Will BSI correct its history if notified?
- For RUB after 2022-03-01 and BYN after 2022-04-01, BSI publishes no rate. Is the InforEuro monthly accounting rate that BSI points to acceptable to FURS for income-tax conversion, or should another source be used?
- Is mapping IBKR's CNH (offshore yuan) to the BSI CNY rate acceptable to FURS? No primary source was found.
- Does the rate date for Doh-KDVP follow the trade date or the settlement date? The instructions say the date "razviden iz prodajne ali druge pogodbe". (Answered in [01 §8](01-furs-doh-kdvp.md#8-modeling-rules-for-a-correct-filing): the trade date, per ZDoh-2 Art. 101 and 102 as restated in the FURS opis; verified.)
- Rounding: FURS requires EUR amounts rounded to 2 decimals in Doh-Div, but the rounding mode (half-up vs. banker's) and whether per-unit Doh-KDVP prices allow more decimals are not covered here. (Partly answered in [01 §7](01-furs-doh-kdvp.md#7-data-formatting-rules): per-unit fields allow 8 decimals, and FURS prescribes no rounding mode.)
- Was ZDoh-2 amended in 2025/2026 in a way the racunovodstvo.net consolidated text (in force 11 Dec 2024) does not yet reflect? Re-verify Art. 16/98/99 on PISRS (pisrs.si needs JavaScript and could not be fetched).
- Does BSI's late insertion of the 2025-12-31 list (done on 2026-01-02) recur every year? It affects a live-update app around New Year but not the Jan–Feb filing season.

## Sources

- [Banka Slovenije - Devizni tečaji (daily ECB reference rates, notes)](https://www.bsi.si/sl/statistika/devizni-tecaji)
- [Banka Slovenije - Exchange rates (English)](https://www.bsi.si/en/statistics/exchange-rates)
- [BSI daily rate list XML (latest)](https://www.bsi.si/_data/tecajnice/dtecbs.xml)
- [BSI daily rate list XML (full history)](https://www.bsi.si/_data/tecajnice/dtecbs-l.xml)
- [BSI XSD (history)](https://www.bsi.si/_data/tecajnice/DtecBS-l.xsd)
- [BSI monthly exotic-currency list (history XML)](https://www.bsi.si/_data/tecajnice/EksotTecBS-l.xml)
- [Mesečna tečajnica Banke Slovenije (monthly list page and notes)](https://www.bsi.si/sl/statistika/devizni-tecaji/mesecna-tecajnica-banke-slovenije)
- [BSI API documentation](https://www.bsi.si/sl/api-dokumentacija)
- [BSI API - daily endpoint](https://api.bsi.si/exchange/daily)
- [BSI Pogoji uporabe (terms of use)](https://www.bsi.si/sl/pogoji-uporabe)
- [BSI Disclaimer and copyright (English)](https://www.bsi.si/en/disclaimer-and-copyright)
- [BSI press release 2015-12-07: change of daily list publication time](https://www.bsi.si/sl/mediji/objave/sporocilo-za-javnost-sprememba-pri-dnevni-tecajnici-referencni-devizni-tecaji-ecb)
- [OPSI dataset: Dnevna in mesečna devizna tečajnica Banke Slovenije](https://podatki.gov.si/dataset/statistika-devizni-tecaji)
- [ECB euro foreign exchange reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)
- [ECB reference rate history (zip)](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip)
- [ECB Data Portal SDMX API (EXR)](https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata)
- [ECB Disclaimer & copyright](https://www.ecb.europa.eu/services/disclaimer/html/index.en.html)
- [ESCB policy regarding the reuse of statistics](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html)
- [ZDoh-2 Art. 16 (racunovodstvo.net consolidated text)](https://www.racunovodstvo.net/zakonodaja/zdoh/16-clen)
- [ZDoh-2 Art. 98](https://www.racunovodstvo.net/zakonodaja/zdoh/98-clen)
- [ZDoh-2 Art. 99](https://www.racunovodstvo.net/zakonodaja/zdoh/99-clen)
- [ZDoh-2 original text, Uradni list RS 117/2006](https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/76404)
- [FURS Doh-Div instructions (PDF)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div.n.sl.pdf)
- [FURS Doh-Div instructions (HTML)](https://edavki.durs.si/OpenPortal/Doc/Durs/Dohodnina/NavodiloZaNapovedDiv.html)
- [FURS Doh-Div XML instructions](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_xml.n.sl.pdf)
- [FURS Doh-KDVP instructions](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp.n.sl.pdf)
- [FURS Doh-KDVP instructions (2025 form)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf)
- [FURS guidance on taxation of derivatives (IFI)](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Davek_od_dobicka_od_odsvojitve_izvedenih_financnih_instrumentov/Opis/Obdavcitev_dobicka_od_odsvojitve_izvedenih_financnih_instrumentov.docx)
- [European Commission InforEuro exchange rates](https://commission.europa.eu/funding-tenders/procedures-guidelines-tenders/information-contractors-and-beneficiaries/exchange-rate-inforeuro_en)
- [InforEuro monthly rates API (2025-10)](https://ec.europa.eu/budg/inforeuro/api/public/monthly-rates?year=2025&month=10)
- [Norges Bank EUR/NOK (cross-check)](https://data.norges-bank.no/api/data/EXR/B.EUR.NOK.SP?format=csv&startPeriod=2025-10-20&endPeriod=2025-10-27&locale=en)
- [jamsix/ib-edavki source (getCurrencyRate)](https://raw.githubusercontent.com/jamsix/ib-edavki/master/ib_edavki.py)
- [BSI PxWeb API (tolar-era rates)](https://px.bsi.si/api/v1/sl/serije_slo/90_devizni_tecaji/10_devizni_tecaji_tolarja)

Also cited during verification:

- [BSI XSD (daily)](https://www.bsi.si/_data/tecajnice/DtecBS.xsd)
- [BSI API - NOK on 2025-10-23](https://api.bsi.si/exchange/daily?code=NOK&date=2025-10-23)
- [BSI API - monthly endpoint](https://api.bsi.si/exchange/exotic)
- [ECB Data Portal EXR NOK series (CORS check)](https://data-api.ecb.europa.eu/service/data/EXR/D.NOK.EUR.SP00.A)
