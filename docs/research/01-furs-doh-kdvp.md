# Doh-KDVP: eDavki XML import format (`Doh_KDVP_9.xsd`)

> Researched: 2026-10-06 · Verification: adversarially verified (21 claims: 20 confirmed, 0 refuted, 1 uncertain) · Updated: 2026-10-07 (F10 polarity settled from the navodila and the display XSLT, §5.2)
>
> Research for building TaxReporter. It is not tax advice, and FURS publications and the law win over anything written here. Inline markers are explained in the [README](README.md#confidence-and-verification-legend).

**Scope.** How to generate an XML file that a Slovenian tax resident can import into the eDavki form **Doh-KDVP** (*Napoved za odmero dohodnine od dobička od odsvojitve vrednostnih papirjev in drugih deležev ter investicijskih kuponov*; paper form "MF-DURS/MF-FURS obr. DOHKAP št. 4"). It covers stocks and ETFs held at foreign brokers, and was researched against the live FURS files. Derivatives and CFDs go on **D-IFI**, which uses a different schema (`D_IFI_4.xsd`, see [02](02-furs-doh-div-and-others.md#11-d-ifi-derivatives-d_ifi_4xsd)).

## 1. Summary

- **The schema is still `Doh_KDVP_9.xsd`.** Version 9 is the current "različica" for business periods from 2013 onward. FURS's schema list shows no v10, and `Doh_KDVP_10.xsd` returns 404 ([FormsXml.aspx](https://edavki.durs.si/EdavkiPortal/OpenPortal/Pages/Technicals/FormsXml.aspx)).
- **FURS edits the v9 file in place without changing its version number.** The live file has `Last-Modified: 06 Aug 2026`. Wayback snapshots show that code **J** was added between 2025-06 and 2026-01, and that code **K** and the element **`TaxDecreaseCooperative`** were added in 2026. All changes so far have been additive. A copy of the XSD vendored into a repo can therefore reject newer codes. Always validate against the live file.
- **File shape:** root `Envelope` in the default namespace `http://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd`. It contains `edp:Header`, an optional `edp:AttachmentList`, a mandatory (possibly empty) `edp:Signatures`, and then `body`. `body` contains `edp:bodyContent`, then `Doh_KDVP`, which holds `KDVP` followed by one `KDVPItem` per security.
- **One `KDVPItem` per security.** It holds a `Securities` (PLVP) element with `Row`s. Each row is either a `Purchase` (F1–F5, F11) or a `Sale` (F6, F7, F9, F10), plus a running stock figure `F8`. All amounts are **EUR per unit**.
- **Short-sale lists use different F2 meanings.** In `PLVPSHORT` and `PLVPGBSHORT` lists, **A = nakup (purchase)**, B = dedovanje, C = darilo, D = drugo. In long lists, B = nakup ([navodila 2025](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf), [XSLT](https://edavki.durs.si/Documents/Transforms/Doh_KDVP_9.23-display-sl.xslt)).
- **The XSD does not require a tax number.** eDavki does, so the generator must enforce it (§3) (corrected after verification).
- **Validation:** the researcher built a worked example (two lots bought in 2024, partly sold in 2026). Both variants **validate with xmllint (libxml 2.9.13)** against the live XSD (§10).

## 2. Primary files and versions

| File | URL | Notes |
|---|---|---|
| Doh-KDVP schema | https://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd | 59,709 bytes, UTF-8 with BOM, CRLF line endings. `Last-Modified: Thu, 06 Aug 2026 10:27:41 GMT`. SHA-256 `c84c2208e2ad7098dd2594b54226308393df9aefb2c9184a81063ec8057967d5` |
| Common envelope types | https://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd | Imported by the KDVP XSD through a relative `schemaLocation="EDP-Common-1.xsd"` |
| Display XSLT | https://edavki.durs.si/Documents/Transforms/Doh_KDVP_9.23-display-sl.xslt | `Last-Modified: 26 Aug 2026`. Holds the official field labels and code legends for each year |
| Older schemas | `Doh_KDVP_8.xsd` (periods 2011–2012), `Doh_KDVP_7.xsd` (2010) | Only needed for history |
| Form instructions, tax years 2025+ | https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf (EN: https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.en.pdf) | Official meaning of every column |
| Printable form, 2025+ | https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.i.sl.pdf (EN: https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.i.en.pdf) | Published in Uradni list RS 107/2025 (19.12.2025) as MF-FURS obr. DOHKAP št. 4 |

FURS's schema list has this row for Doh-KDVP: valid from 01.01.2014, **version 9**, business period 01.01.2013 onward (no end date), flags "Uvoz" ✔ and "VD" ✔, **SOAP ✗**, filed by **FO**, XSLT `Doh_KDVP_9.23`.

**History of in-place edits to `Doh_KDVP_9.xsd`**, from Wayback Machine snapshots ([snapshot index](https://web.archive.org/cdx/search/cdx?url=edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd&output=json&collapse=digest); snapshots from 2016-03, 2022-08, 2024-07, 2025-02, 2025-06 and 2026-01 were compared):

| Snapshot | Change |
|---|---|
| 2016-03 | F3/F7 and F4/F9 had 4 decimals. F1/F3/F4/F6/F7/F9 were required. Row `ID` was optional |
| by 2022-08 | Quantities and prices widened to 8 decimals. All F fields became optional. `ID` became required. F8 may be negative |
| by 2024-07 | Added `Resolution`/`ResolutionDate`, `F11`, the `PLVPZOK` list (`SecuritiesCapitalReduction`), `ItemID`, `AttachmentHash`, and new PLD fields |
| 2025-06 → 2026-01 | Added F2 code **J** |
| 2026-01 → 2026-08-06 | Added F2 code **K**, widened the description of **I**, added `KDVPItem/TaxDecreaseCooperative` |

The verifier re-pulled the two boundary snapshots: `20250623101347` has no J, no K and no `TaxDecreaseCooperative`; `20260117203514` has J only; the live file has all three.

## 3. Envelope (namespaces, header, encoding)

```text
Envelope                                   (ns: …/Doh_KDVP_9.xsd, default namespace)
├─ edp:Header                              required (ns: …/EDP-Common-1.xsd)
│  ├─ edp:taxpayer                         required
│  │  ├─ edp:taxNumber | edp:vatNumber     choice, but both options minOccurs=0 (see below).
│  │  │                                    taxNumber: 8 digits [0-9]{8}
│  │  ├─ edp:taxpayerType                  FO | PO | SP  (use FO)
│  │  ├─ edp:name, edp:address1, edp:address2, edp:city
│  │  ├─ edp:postNumber (max 12), edp:postName, edp:municipalityName
│  │  ├─ edp:birthDate (xs:date), edp:maticnaStevilka, edp:invalidskoPodjetje
│  │  └─ edp:resident, edp:activityCode, edp:activityName, edp:countryID, edp:countryName
│  ├─ edp:responseTo?   edp:Workflow? (edp:DocumentWorkflowID, edp:DocumentWorkflowName)
│  └─ edp:CustodianInfo?   edp:domain?
├─ edp:AttachmentList?                     (may be empty)
├─ edp:Signatures                          REQUIRED, may be empty <edp:Signatures/>
└─ body
   ├─ edp:bodyContent                      required, empty
   ├─ Doh_KDVP                             required
   └─ AttachmentHash?                      (Hash)
```

**The tax number is not enforced by the XSD** (corrected after verification). Every element in the taxpayer block is optional at XSD level, including the tax number: both options of the `taxNumber`/`vatNumber` choice are `minOccurs=0`, so a `taxpayer` element with no tax number at all validates (tested by the verifier). The help page says the tax number is the one mandatory item ("Obvezen je podatek o davčni številki zavezanca", [help](https://edavki.durs.si/EdavkiPortal/PersonalPortal/[360253]/Pages/Help/sl/Documents_Doh_KDVP_PopisniListi.htm)). The generator must therefore require an 8-digit `taxNumber` itself; XSD validation alone will not catch its absence. ib-edavki sends `taxNumber`, `taxpayerType`, `name`, `address1`, `city`, `postNumber` and `postName`.

**Encoding.** Use UTF-8. FURS's web-import specification asks for "XML zakodiran v UTF-8 (zaželeno)" ([webimport](https://edavki.durs.si/EdavkiPortal/OpenPortal/CommonPages/Opdynp/PageD.aspx?category=technicals_webimport)). Use the KDVP namespace as the **default namespace**, exactly as all working open-source tools do. `elementFormDefault="qualified"`, so `body`, `Doh_KDVP` and the rest must be in that namespace.

**Legacy wording to ignore.** The help page says the root must be `Doh_KDVP_Data`. No such schema exists (404), and the D-IFI help page repeats the same sentence, so it is a copy-paste leftover. All working tools (ib-edavki and others) use `Envelope`. The verifier reached the same conclusion.

## 4. `Doh_KDVP` body

Child order: `KDVP`, then `TaxRelief*`, `TaxBaseDecrease*`, `Attachment*`, `KDVPItem*`.

### 4.1 `KDVP` (header data). Order matters.

| # | Element | Type / limits | Req. | Meaning |
|---|---|---|---|---|
|1|DocumentWorkflowID|string, max 1 char|opt|Document type. **`O` = original.** The generic eDavki list is O, B, R, P, I, V, Z, S ([WorkflowType1](https://edavki.durs.si/EdavkiPortal/PersonalPortal/[360253]/Pages/Help/sl/WorkflowType1.htm))|
|2|DocumentWorkflowName|string|opt||
|3|Year|int, pattern `[1-9][0-9]{3}`|opt|Tax year|
|4|PeriodStart / 5 PeriodEnd|xs:date|opt|Inside `Year`. Residents use 01-01 to 12-31|
|6|IsResident|xs:boolean|opt|`true` for SI residents|
|7|CountryOfResidenceID|`[0-9]{3}`|opt|Non-residents only|
|8|CountryOfResidenceName|max 40|opt||
|9|TelephoneNumber|string|opt||
|10–14|**SecurityCount, SecurityShortCount, SecurityWithContractCount, SecurityWithContractShortCount, ShareCount**|int ≥ 0|**required** (default 0)|Number of lists of each type|
|15|SecurityCapitalReductionCount|int ≥ 0|opt|PLVPZOK lists|
|16–19|RemissionState, RemissionArticle (max 4), ResConfirmationInstitution (max 100), ResConfirmationDate|—|opt|Treaty relief, non-residents only|
|20|Email|string|opt|The XSD annotation wrongly says "Telefonska številka"|

`TaxRelief` covers offsetting real-estate losses: OrderNumber, OrderDate, AcquirementDate, ExpropriationDate, Loss, Profit, IncomeTax (amounts 12+2 digits), IsPrefilled. `TaxBaseDecrease` covers carried-forward losses under 97(3) ZDoh-2: OrderNumber, OrderDate, TaxOfficeID `[0-9]{2}`, TaxOfficeName, Loss. `Attachment/Document` is max 70 characters.

### 4.2 `KDVPItem` (one per inventory list, "popisni list")

| Order | Element | Type | Req. | Meaning |
|---|---|---|---|---|
|1|ItemID|int ≥ 0|opt|List ID|
|2|**InventoryListType**|enum|**required**|See §5.1|
|3|Name|max 100|opt|List title shown in eDavki|
|4|HasForeignTax|bool|opt|Capital-gains tax paid abroad|
|5|ForeignTax|`\d{1,10}(\.\d{1,4})?`|opt|Foreign tax in EUR|
|6|FTCountryID|`[0-9]{3}`|opt|3-digit numeric country code (for example 840). It is **not** alpha-2|
|7|FTCountryName|max 40|opt||
|8|HasLossTransfer|bool|opt|Carry-forward of loss under 97(3) ZDoh-2. This only applies to shares acquired before bonus-share capital increases. Use `false` in normal cases|
|9|ForeignTransfer|bool|opt|Shares acquired abroad in an exchange under Directive 90/434/EEC with deferred taxation|
|10|TaxDecreaseConformance|bool, nillable|opt|Venture-capital exemption, 96(2)(5) ZDoh-2|
|11|TaxDecreaseCooperative|bool, nillable|opt|**Added to the live XSD in 2026.** Sale to a workers' cooperative under ZLZD (PLD lists)|
|12|choice: `Securities` \| `SecuritiesShort` \| `Shares` \| `SecuritiesWithContract` \| `SecuritiesWithContractShort` \| `SecuritiesCapitalReduction`|—|choice (each has minOccurs=0)|The list body|

The XSD declares `xs:unique` constraints, but their selector (`r:Securities` relative to `Doh_KDVP`) matches nothing, so they have no effect. Two items with the same name validate fine (tested).

## 5. Lists, rows and fields

### 5.1 `InventoryListType` values

| Value | Body element | Meaning |
|---|---|---|
|`PLVP`|`Securities`|Security or fund unit, long position. **Use this for normal stock and ETF sales**|
|`PLVPSHORT`|`SecuritiesShort`|Short sales|
|`PLVPGB`|`SecuritiesWithContract`|Held under a portfolio-management contract with a broker. **May** be kept as a separate FIFO pool; the separate pool is optional, not mandatory (corrected after verification, see §8)|
|`PLVPGBSHORT`|`SecuritiesWithContractShort`|Short sales under such a contract|
|`PLD`|`Shares`|Holdings in companies or cooperatives (d.o.o. etc.)|
|`PLVPZOK`|`SecuritiesCapitalReduction`|Share-capital reduction with the share count unchanged|

The XSD defines exactly these six values. It does not itself state the mapping to body elements; the mapping follows from the element annotations and the KP-KDVP broker guidance.

### 5.2 `Securities` (PLVP). `SecuritiesWithContract` is the same, plus `StockExchangeName` (max 30) after `IsFond`.

Element order: `ISIN` (max 12), `Code` (max 10, the ticker), `Name` (max 100), **`IsFond` (required, boolean)**, `Resolution` (max 100), `ResolutionDate`, then `Row*`.

`Row` contains: **`ID`** (required, int ≥ 0), then **exactly one** of `Purchase` or `Sale`, then optional `F8`.

| Field | Container | XSD type / pattern | Official column meaning ([navodila](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf)) |
|---|---|---|---|
|F1|Purchase|xs:date|Acquisition date (trade date), rows in chronological order|
|F2|Purchase|enum A–K|Acquisition method (§6)|
|F3|Purchase|`\d{1,12}(\.\d{1,8})?`|Quantity acquired|
|F4|Purchase|`\d{1,14}(\.\d{1,8})?`|**Acquisition value per unit, EUR** (Banka Slovenije rate on the acquisition date)|
|F5|Purchase|`\d{1,10}(\.\d{1,4})?`|Inheritance/gift tax paid on this acquisition (EUR)|
|F11|Purchase|`\d{1,14}(\.\d{1,8})?`|Reduced per-unit cost after an earlier capital reduction with unchanged quantity. PLVP and PLVPGB only|
|F6|Sale|xs:date|Disposal date|
|F7|Sale|`\d{1,12}(\.\d{1,8})?`|Quantity disposed (a positive number)|
|F9|Sale|`\d{1,14}(\.\d{1,8})?`|**Value at disposal per unit, EUR** (BSI rate on the disposal date)|
|F10|Sale|xs:boolean|Column 10, "DA/NE": **true = the condition for the loss to reduce the tax base is met**, meaning the 30-day wash-sale rule and the family/25% related-party rule of 97(2)/(5) ZDoh-2 are *not* triggered. PLVP and PLVPGB only. See the polarity note below the table|
|F8|Row|`[-]?\d{1,12}(\.\d{1,8})?`|Running stock after the row ("Zaloga"), kept FIFO|

The instructions say: purchase rows fill columns 1, 2, 3, 4, 5, 8 and 11; sale rows fill 6, 7, 8, 9 and 10.

**F10 polarity is not fully settled** (corrected after verification; raised by the [04](04-si-tax-rules.md#53-wash-sale-rule-pravilo-navidezne-odsvojitve-art-975) verification). Column 10 "DA" means the condition for the loss to reduce the base is met (navodila, confirmed by this doc's verifier), and the display XSLT shows `true` as "Da" (§7), so "`true` = the loss may reduce the base" is the supported reading. However, the XSD itself documents F10 only by the rule's name and publishes no true/false semantics, and prior-art tools disagree: t212-edavki writes `true`, while LazyFURS, brrr-generator and mp_tax-generator write `false`. Confirm with an eDavki import test before code relies on it.

**Settled on 2026-10-07 from primary sources** (the import test was not possible: the tax-year-2026 form only opens in January 2027). Both were re-read for this decision: the navodila ([doh_odm_kdvp_25.n.sl.pdf](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf), `Last-Modified: Wed, 14 Jan 2026 06:30:35 GMT`, SHA-256 `0c8244f13f526b35c9fe601252ffd5c69125f9de8396c79cfeea648e608b4823`) and the display XSLT ([Doh_KDVP_9.23-display-sl.xslt](https://edavki.durs.si/Documents/Transforms/Doh_KDVP_9.23-display-sl.xslt), `Last-Modified: Wed, 26 Aug 2026 13:43:59 GMT`, SHA-256 `69f155a138ccf292025818b88668c19be664e006e8c782c1662709b59d6c1ef3`), both retrieved 2026-10-07.

- The navodila say: "V stolpec 10 se vpiše »DA«, če je izpolnjen pogoj za zmanjšanje pozitivne davčne osnove, oziroma »NE«, če pogoj ni izpolnjen." The English edition says the same ("indicate “YES” if the condition for reducing the positive tax base has been fulfilled").
- The XSLT renders `Sale/F10` with its `YesNo` template, which prints "Da" for `true` (compared case-insensitively) and "Ne" for `false` **and for a missing value**, under the footnote "Izpolnjeni pogoji za zmanjšanje pozitivne davčne osnove po drugem odstavku v povezavi s petim odstavkom 97. člena ZDoh-2 (vpisuje se DA oziroma NE)".
- So **`true` = the loss may reduce the tax base** (no replacement capital within the 30-day window), and `false` = it may not. Tools that write `false` for an ordinary loss report it as not deductible.
- **An omitted F10 displays as "Ne".** Whether the eDavki backend also treats it as "NE" is not documented, but the safe assumption is that it does: omitting F10 on a loss is the conservative choice (the loss does not reduce the base), never an under-statement. `packages/furs` writes F10 only when it has been determined.

### 5.3 Short lists (`SecuritiesShort`, `SecuritiesWithContractShort`)

These use the same XML fields **but have no F10 and no F11** (adding F10 fails validation, tested). The rows are entered **sales first, then purchases**, each group chronological. F8 runs ≤ 0. For example, a sale of 10 gives F8 = −10, and the covering purchase brings it back to 0.

The form numbers the columns differently. The display maps them as: 1 = F6, 2 = F7, 3 = F9, 4 = F1, 5 = F2, 6 = F3, 7 = F8, 8 = F4, 9 = F5 (XSLT).

### 5.4 `Shares` (PLD) and `SecuritiesCapitalReduction` (PLVPZOK)

These are rarely needed for broker exports.

- **PLD:** `Name`, `ForeignCompany`, `DivestmentTaxNumber`, `SubsequentPayments`, `SubsequentPaymentRow*` (PaymentTaxNumber, PaymentDate, PaymentAmount), then `Row`.
  - Purchase fields: F1 date, F2 method, F3 value (total), F4 gift tax.
  - Sale fields: F5 date, F6 % of holding disposed (0–100, 4 decimals), F8 value, F9 bool.
  - Row-level F7 is the holding value after the sale.
- **PLVPZOK:** Purchase has F1–F4. Sale has F5 date, F6 % of capital reduction, and F7 amount paid out.

## 6. Acquisition method codes (`F2`, type `typeGainType`)

The XSD allows exactly **A B C D E F G H I J K** (case-sensitive; `b` is rejected). The meaning depends on the list type, and the display legend depends on the tax year (the XSLT checks whether the `PeriodEnd` year is ≥ 2025 or ≥ 2026).

**Long lists (PLVP):**

|Code|Slovenian|Meaning|Valid from|
|---|---|---|---|
|A|vložek kapitala|capital contribution|—|
|**B**|**nakup**|**purchase (normal broker buy)**|—|
|C|povečanje kapitala družbe z lastnimi sredstvi zavezanca|capital increase paid by the taxpayer (e.g. rights issue)|—|
|D|povečanje kapitala družbe iz sredstev družbe|bonus issue from company funds (cost = 0)|—|
|E|zamenjava kapitala ob statusnih spremembah družbe|exchange on merger/division|—|
|F|dedovanje|inheritance|—|
|G|darilo|gift|—|
|H|drugo|other|—|
|J|pridobitev kapitala v inovativnih zagonskih podjetjih (45.b ZDoh-2)|innovative start-up employee shares|tax year 2025+|
|K|prenos VP / investicijskih kuponov iz INR na trgovalni račun|transfer from an Individual Investment Account (INR) to a trading account; such securities count as acquired on the transfer date (§8)|tax year 2026+|

**PLVPZOK** follows the same legend in the XSLT, **except** that the printed 2025 form (Uradni list RS 107/2025) labels the innovative start-up code **I** on the PLVPZOK legend, where PLVP uses **J** (corrected after verification).

**PLD:** A–H, plus **I** = increase of a capital share in a partnership through allocated profit (only for allocations after 25.4.2014), plus J from 2025.

**PLVPGB (2026+ legend):** A–G, plus **I** = transfer from INR. The legend omits H. This conflicts with PLVP, where the INR transfer is K.

**What to emit** (corrected after verification): for foreign-broker data, restrict output to **B, F, G, H** (and D or E where a corporate action calls for them). Flag **I, J and K** for manual handling, because their meaning differs between list types and between the printed form and the XSLT.

**Short lists (PLVPSHORT, PLVPGBSHORT):** **A = nakup**, B = dedovanje, C = darilo, D = drugo. The navodila say "V stolpec 5 se vpiše način pridobitve po oznakah (A, B, C, D)", and both the official Slovenian form and the official English form ("A purchase, B inheritance, C gift, D other") give this legend. ib-edavki emits `A` for short covers.

## 7. Data formatting rules

- **Dates:** `xs:date`, written `YYYY-MM-DD`. `2026-05-20T00:00:00` and `20.05.2026` are rejected.
- **Decimals:** use a dot as the separator. No thousands separators, no exponent notation, no leading `.`, and no trailing `.` (all tested). Signs are only allowed in F8. F7 must be positive.
- **Limits:** quantities allow 12 integer digits and 8 decimals. Per-unit prices allow 14 integer digits and 8 decimals. F5 and ForeignTax allow 10 integer digits and **4** decimals. Loss amounts in TaxRelief/TaxBaseDecrease allow 12 integer digits and 2 decimals.
- **Rounding:** FURS prescribes no rounding rule. Compute the EUR per-unit value as `price_ccy / BSI_rate` and round half-up to 8 decimals. Round every field to its own precision: 8 decimals for F3/F4/F7/F9/F11, but only 4 for F5 and ForeignTax. The paper form's note "Zneski se vpisujejo v EUR s centi" applies to manual entry, not to the XML (corrected after verification). Truncate `Code` to 10 characters (ib-edavki does `[:10]`).
- **Booleans:** always write lowercase `true`/`false` (corrected after verification). The XSD also accepts `1`/`0`, but the official display XSLT's `YesNo` template shows "Da" only for the string `true` (compared case-insensitively) and "Ne" for anything else, so `1` displays as "Ne". `xs:boolean` itself rejects `TRUE`, so lowercase `true`/`false` is the only safe choice. The XSLT only affects display; how the eDavki backend interprets `1` is unknown.
- **Row IDs:** contiguous from 0, as ib-edavki and brrr-generator do. eDavki renumbers rows by position for display anyway.

## 8. Modeling rules for a correct filing

- **Who files and when.** The deadline is **28 February** of the following year ([navodila](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf)). For tax year 2026 that date, 28 Feb 2027, is a Sunday (corrected after verification). When 28 Feb 2026 fell on a Saturday, FURS publicly moved the deadline to Monday 2 March 2026 ([gov.si](https://www.gov.si/novice/2026-01-26-javni-pozivi-k-vlozitvi-napovedi-do-2-marca-2026/)), so the effective deadline for tax year 2026 should be Monday 1 March 2027. Treat that as medium confidence until FURS announces it. Non-residents must file within 15 days of the disposal unless they report the whole year. Filing must be electronic through eDavki if there were **more than 10 transactions**, counting past-year acquisitions and taxable disposals in the year. Lots held **15 years or more** are not taxed and are not listed. No filing is needed for debt securities.
- **FIFO across brokers.** "Zaloge istovrstnega kapitala se vodijo po metodi zaporednih cen (FIFO)" ([FURS opis](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Obresti_dividende_in_dobicek_iz_kapitala.doc)). The app must therefore merge the same ISIN from all brokers into **one** KDVPItem and run FIFO on the combined history. The only exception is securities held under a portfolio-management contract (PLVPGB), and that exception is **optional** (corrected after verification): the opis says the taxpayer "lahko vodi ločeno evidenco" (*may* keep a separate record).
- **Which purchase rows to include (positions with history across years).** eDavki computes FIFO and tax from the rows it is given, so purchases from earlier years must appear.
  - *Recommended:* list the lots, or parts of lots, that the tax year's sales consume under FIFO, whatever year they were bought in, with their original dates and costs. Then list all sales in the tax year. The final F8 is 0. This matches how FURS prefills from domestic brokers ("transakcije o pridobitvah, ki zapirajo transakcije odsvojitve (ne glede na leto)", [KP-KDVP usmeritve](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Usmeritve_pri_dostavi_podatkov_KP-KDVP.docx)) and how ib-edavki works.
  - *Acceptable alternative:* list whole remaining lots, so the final F8 is above 0.
  - Do **not** include sales from earlier years. Instead, reduce the lots by what earlier years' FIFO already consumed.
  - **Every list needs at least one purchase and one sale** (corrected after verification). The eDavki help page counts a list as correctly entered only if it has at least one acquisition and one disposal ("Za pravilen vnos popisnega lista pa se šteje, če je vnešena vsaj ena pridobitev in ena odsvojitev"). Do not emit purchase-only lists, for example for positions still held with no sale in the year.
- **Partial sales.** These follow naturally from FIFO; see the example in §10.
- **F8 consistency** (unverified — see Verification). Reportedly, eDavki rejects lists where F8 drops below 0 in a long list or rises above 0 in a short list (ib-edavki PR #213). The XSD itself accepts negative F8. The only source is a community pull request whose description says its code was AI-written, and no FURS document states the rule. Keeping F8 ≥ 0 in long lists and ≤ 0 in short lists is still a sound defensive check.
- **F10 and the 30-day window cross the year end** (corrected after verification). The wash-sale test looks 30 days before *and after* each loss-making sale. A loss on a sale in late December 2026 can be disqualified by a repurchase in January 2027, so the app needs trade data past the year end, or must warn, before it sets `F10=true`.
- **Losses offset gains only within the same tax year** (corrected after verification). A carry-forward exists only in the special 97(3) case of shares acquired before a bonus issue (`HasLossTransfer`/`TaxBaseDecrease`). Do not model a general loss carry-forward.
- **Short positions.** Use PLVPSHORT (§5.3, §6). Derivatives and CFDs go on D-IFI.
- **Stock splits.** A split is a non-taxable exchange of same-type securities from the same issuer with no cash flow (FURS opis). Common practice, as in ib-edavki, is to restate the pre-split purchase rows: quantity × ratio, unit price ÷ ratio, original date kept. No extra row is added. If the split changes the ISIN, keep a single item. Cash paid for fractional shares is a normal sale. *(Community practice, not a written FURS rule.)*
- **Gifts and inheritances received.** Use F2 = G or F. F4 is the value on which gift/inheritance tax was assessed, or the market price if none was assessed. F5 is the tax paid. Giving shares away is itself a disposal, unless a deferral ("odlog") is claimed for a gift to a spouse or child. In that case the recipient later uses the donor's date and cost. The deferral must be notified separately by 28 February, and inheritance is not a disposal (corrected after verification).
- **Transfers between brokers** are not disposals. Keep the original acquisition dates and costs.
- **Fees.** Actual commissions are not added. eDavki deducts the flat costs ("normirani stroški") of 1% of cost + 1% of proceeds, capped at the gain, and only when there is a gain. So F4/F9 should be the per-unit trade price **excluding commission** (FURS opis).
- **Currency and date** (corrected after verification). Convert at the Banka Slovenije rate valid on the acquisition or disposal date; that rate rule is in the navodila. The time of acquisition or disposal is the date the contract is concluded, i.e. the **trade date, not the settlement date**. That rule comes from ZDoh-2 Articles 101 and 102 as restated in the FURS opis ("Za čas pridobitve kapitala se šteje datum sklenitve pogodbe"; "…ni relevantno, kdaj dejansko pride do plačila kupnine"), not from the navodila. **Exception:** securities moved from an INR to a trading account count as acquired on the date of the transfer to the trading account, not the original purchase date (code K, §6). See [03](03-bsi-exchange-rates.md#9-weekends-holidays-and-target-closing-days) for which rate list applies on days without one.
- **Rates** (eDavki computes them per lot): 25%; 20% after 5 years; 15% after 10 years; 0% after 15 years (FURS opis, August 2026 edition).

## 9. Importing into eDavki

1. **Dokumenti → Uvoz dokumenta**: choose the XML, click "Uvozi dokument", and the pre-filled form opens ([help](https://edavki.durs.si/EdavkiPortal/PersonalPortal/[360253]/Pages/Help/sl/Documents_Import.htm)).
2. Alternatively, open **Nov dokument → Doh-KDVP**, choose last year's period and type **O**, click "Uvoz popisnih listov", select the file, and press "Izračun" on each list (ib-edavki README).
3. **Merging on import.** Importing a PLVP or PLD list that already exists in the return merges its transactions into that list. Importing a PLVPGB list always adds a new one. After import, eDavki reports the lists it added, the lists it merged, and any errors ([help](https://edavki.durs.si/EdavkiPortal/PersonalPortal/[360253]/Pages/Help/sl/Documents_Doh_KDVP_PopisniListi.htm)). The help page covers only PLVP, PLD and PLVPGB lists. It says nothing about short or PLVPZOK lists, or about which key decides that a list "already exists" (corrected after verification).
4. **Schema errors** come back in this .NET style: "Na mestu '6' v vrstici '32' je napačen element 'Type'. Pričakovana lista elementov : …" ([ib-edavki #176](https://github.com/jamsix/ib-edavki/issues/176)). In practice these are wrong element order or unknown elements.
5. **Non-critical warnings** include "Popisni list vsebuje nekritične napake" and "Obstaja možnost, da pogoji za zmanjšanje pozitivne davčne osnove niso izpolnjeni", the wash-sale hint ([ib-edavki #155](https://github.com/jamsix/ib-edavki/issues/155)).
6. **Current-year returns cannot be filed.** The Doh-KDVP form for tax year 2026 opens in January 2027. ib-edavki's `-t` flag works around this for a test calculation.
7. **Programmatic hand-off.** Instead of a manual upload, an app can send an HTTP POST to `https://edavki.durs.si/EdavkiPortal/PersonalPortal/Pages/Login/Login.aspx` with these fields: `ImportDocument` (the UTF-8 XML, base64-encoded), `TaxPayerID` (8 digits), `TaxPayerType` (FO). A test system is available at `beta.edavki.durs.si` ([webimport](https://edavki.durs.si/EdavkiPortal/OpenPortal/CommonPages/Opdynp/PageD.aspx?category=technicals_webimport)).
8. **File-size limit:** no published limit was found. A tax-year-2025 file with about 90 securities and 1,550 lots was reportedly accepted ([ib-edavki PR #213](https://github.com/jamsix/ib-edavki/pull/213)).

## 10. Worked example: two lots bought in 2024, 12 of 15 shares sold in 2026

The FX rates are ECB reference rates, which Banka Slovenije republishes: 2024-03-15 USD 1.0892, 2024-08-05 USD 1.0966, 2026-05-20 USD 1.16. None of these dates is one of the six known BSI≠ECB discrepancies ([03 §8](03-bsi-exchange-rates.md#8-are-bsi-rates-identical-to-ecb-reference-rates)). The trades are illustrative:

- Lot 1: 2024-03-15, 10 shares @ USD 172.62
- Lot 2: 2024-08-05, 5 shares @ USD 209.27
- Sale: 2026-05-20, 12 shares @ USD 250.00

This is the matched-lots variant. **`xmllint --noout --schema Doh_KDVP_9.xsd` reports "validates".**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Envelope xmlns="http://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd"
          xmlns:edp="http://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd">
  <edp:Header>
    <edp:taxpayer>
      <edp:taxNumber>12345678</edp:taxNumber>
      <edp:taxpayerType>FO</edp:taxpayerType>
      <edp:name>Janez Novak</edp:name>
      <edp:address1>Slovenska cesta 1</edp:address1>
      <edp:city>Ljubljana</edp:city>
      <edp:postNumber>1000</edp:postNumber>
      <edp:postName>Ljubljana</edp:postName>
    </edp:taxpayer>
    <edp:Workflow><edp:DocumentWorkflowID>O</edp:DocumentWorkflowID></edp:Workflow>
  </edp:Header>
  <edp:AttachmentList/>
  <edp:Signatures/>
  <body>
    <edp:bodyContent/>
    <Doh_KDVP>
      <KDVP>
        <DocumentWorkflowID>O</DocumentWorkflowID>
        <Year>2026</Year>
        <PeriodStart>2026-01-01</PeriodStart>
        <PeriodEnd>2026-12-31</PeriodEnd>
        <IsResident>true</IsResident>
        <TelephoneNumber>041123456</TelephoneNumber>
        <SecurityCount>1</SecurityCount>
        <SecurityShortCount>0</SecurityShortCount>
        <SecurityWithContractCount>0</SecurityWithContractCount>
        <SecurityWithContractShortCount>0</SecurityWithContractShortCount>
        <ShareCount>0</ShareCount>
        <Email>janez.novak@example.com</Email>
      </KDVP>
      <KDVPItem>
        <ItemID>1</ItemID>
        <InventoryListType>PLVP</InventoryListType>
        <Name>Apple Inc.</Name>
        <HasForeignTax>false</HasForeignTax>
        <HasLossTransfer>false</HasLossTransfer>
        <ForeignTransfer>false</ForeignTransfer>
        <TaxDecreaseConformance>false</TaxDecreaseConformance>
        <Securities>
          <ISIN>US0378331005</ISIN>
          <Code>AAPL</Code>
          <Name>Apple Inc.</Name>
          <IsFond>false</IsFond>
          <Row><ID>0</ID>
            <Purchase><F1>2024-03-15</F1><F2>B</F2><F3>10</F3><F4>158.48329049</F4><F5>0</F5></Purchase>
            <F8>10</F8></Row>
          <Row><ID>1</ID>
            <Purchase><F1>2024-08-05</F1><F2>B</F2><F3>2</F3><F4>190.83530914</F4><F5>0</F5></Purchase>
            <F8>12</F8></Row>
          <Row><ID>2</ID>
            <Sale><F6>2026-05-20</F6><F7>12</F7><F9>215.51724138</F9><F10>true</F10></Sale>
            <F8>0</F8></Row>
        </Securities>
      </KDVPItem>
    </Doh_KDVP>
  </body>
</Envelope>
```

The contact data (name, address, phone, email) is placeholder data for the example only. A real file must carry the user's own details; see [05 §4](05-prior-art.md#4-pitfalls-from-issue-trackers-and-what-they-mean-for-us).

**Full-lots variant (also validates):** row 1 has `F3=5` and `F8=15`, and the sale row ends with `F8=3`.

**Expected result** (eDavki does the actual calculation):

- Cost: 1,966.50 EUR
- Proceeds: 2,586.21 EUR
- Gain: 619.70 EUR
- Flat costs: 45.53 EUR
- Tax base: 574.18 EUR
- Holding period under 5 years, so 25%: tax ≈ **143.54 EUR**

**Negative tests run with xmllint** (each invalid):

- 9 decimals in F4
- `F2=Z` or `F2=b`
- `IsFond` missing
- `ShareCount` missing
- comma as decimal separator
- `1E1`, `.5`, `10.`
- `F7=-12`
- a 13-digit quantity
- `Code` of 11 characters, ISIN of 13, `Name` of 101
- `edp:Signatures` missing
- `Year=26`
- dates given as dateTime or `dd.mm.yyyy`
- `IsResident=DA`
- `Year` and `PeriodStart` swapped
- Row without `ID`, or `ID=-1`
- `PLVPG`
- a 7-digit tax number
- `DocumentWorkflowID=OO`
- `F5=0.00001`, `ForeignTax=1.23456`
- `FTCountryID=US`
- F10 inside `SecuritiesShort`
- a v8 namespace

These were **valid**: `F2=K`, `F8=-3`, boolean `1`, F10 omitted, all F8 omitted, a KDVPItem with no list element, duplicate KDVPItems, a minimal header (`taxNumber` only), and a windows-1250 encoded file. The verifier adds a `taxpayer` element with **no** tax number to this list. XSD-valid is not the same as accepted: eDavki still requires the tax number (§3), and it counts a list without at least one purchase and one sale as incorrectly entered (§8) (corrected after verification).

## 11. Pitfalls found in open-source tools

- brrr-generator's enum uses `PLVPG` instead of **`PLVPGB`**, which fails the XSD.
- One Trading 212 tool writes `HasLossTransfer=true` and `F8=0` on every row, and opens a separate KDVPItem for each trade. It depends on eDavki merging the lists afterwards. Don't copy this.
- ib-edavki still formats values to 4 decimals. That validates, but v9 allows 8.
- Vendored copies of the XSD are outdated: no J or K codes, no `TaxDecreaseCooperative`.

## Verification

An independent verifier re-checked the 21 critical claims against the live XSDs, the XSLT, the 2025 navodila and form, the FURS opis and usmeritve, the eDavki help pages and the Wayback snapshots. 20 were confirmed. None was refuted.

**Claims not confirmed:**

| Claim | Verdict | Correction / note | Evidence |
|---|---|---|---|
| eDavki rejects files in which F8 goes negative in a long list or positive in a short list, even though the XSD allows negative F8 (§8). | uncertain | No correction. The only source is a community PR whose description says its code was AI-written. No FURS document states the rule. The XSD does allow a negative F8 (`typeDecimalNeg12_8`). Keeping F8 ≥ 0 for long lists and ≤ 0 for short lists is still a sound defensive rule. | [ib-edavki PR #213](https://github.com/jamsix/ib-edavki/pull/213) |

**Missed items** (facts the verifier found that the report lacked; each is applied inline where noted):

- **INR transfers.** Securities moved from an Individual Investment Account (INR, under ZINR) to a trading account count as acquired on the date of the transfer, not the original purchase date (FURS opis, August 2026). This is code K from tax year 2026 on PLVP, but code I on PLVPGB. An app that ingests INR data needs this rule. Applied in §6 and §8.
- **Tax year 2026 deadline.** 28 Feb 2027 is a Sunday. FURS moved the 2026 deadline from Saturday 28 Feb to 2 March 2026 ([gov.si](https://www.gov.si/novice/2026-01-26-javni-pozivi-k-vlozitvi-napovedi-do-2-marca-2026/)), so plan for Monday 1 March 2027 with medium confidence until FURS announces it. Applied in §8.
- **Enforce the tax number in code.** Both options of the `taxNumber`/`vatNumber` choice are `minOccurs=0`, so a header with no tax number passes the XSD, while the help page says the tax number is mandatory. Applied in §1, §3 and §10.
- **Restrict F2 codes for foreign-broker data to B, F, G, H** (plus D or E for corporate actions) and flag I, J and K for manual handling. The printed form (Uradni list RS 107/2025, 19.12.2025, MF-FURS obr. DOHKAP št. 4) labels the start-up code I on PLVPZOK but J on PLVP, and the PLVPGB 2026 XSLT legend uses I for the INR transfer and omits H. Applied in §6.
- **Never emit a list without at least one purchase and one sale.** The eDavki help page counts only such lists as correctly entered. Applied in §8 and §10.
- **F10 needs data past the year end.** The 30-day window runs before and after each loss-making sale, so a late-December loss can be disqualified by a January repurchase. Fetch next-year trades or warn before writing `F10=true`. Applied in §8.
- **No general loss carry-forward.** Losses offset gains only within the same tax year; carry-forward exists only in the 97(3) bonus-issue case (`HasLossTransfer`/`TaxBaseDecrease`). Applied in §8.
- **Round each field to its own precision.** Per-unit fields allow 8 decimals, F5 and ForeignTax only 4. "Zneski se vpisujejo v EUR s centi" is a paper-form rule for manual entry. Applied in §7.
- **Out of scope for Doh-KDVP:** debt securities need no filing, and derivatives and CFDs go on D-IFI under a separate law. A secondary source (kalko.si) says that from 1 Jan 2026 derivatives are taxed at a flat 25% regardless of holding period. The verifier did not check this against PISRS, so it was low confidence here; it has since been confirmed in [04 §2.4](04-si-tax-rules.md#24-contrast-derivatives-under-zddoifi-filed-on-doh-ifi-not-doh-kdvp) (ZDDOIFI-B, UL 85/2025, applies to tax years from 1 Jan 2026).
- **Gifting securities is a disposal** unless a deferral ("odlog") is claimed for a gift to a spouse or child, and that deferral must be notified separately by 28 February. Inheritance is not a disposal. Applied in §8.
- **Pin the verified schema.** The live XSD the verifier checked has SHA-256 `c84c2208e2ad7098dd2594b54226308393df9aefb2c9184a81063ec8057967d5`; a change in hash or `Last-Modified` means FURS edited the file. Applied in §2.

**Qualifications on confirmed claims** (verifier notes that refine a confirmed claim):

- *F2 codes (§6):* the I/J/K assignment differs between list types (see above).
- *Short-list legend (§6):* the printed 2025 form legend for both short lists reads "A nakup, B dedovanje, C darilo, D drugo".
- *Purchase fields:* the navodila confirm that columns 4 and 9 are "na enoto" (per unit). Their wording for column 5 implies a total, not a per-unit amount.
- *Number formats (§7):* the XSD type `typeDecimalPos14_4` is misleadingly named; its pattern is 10 integer digits plus 4 decimals. xmllint rejected `F5=0.00001` with a pattern error.
- *FIFO (§8):* the separate PLVPGB pool is optional ("lahko"). Applied inline.
- *Trade date (§8):* the rule is sourced from ZDoh-2 Art. 101 and 102 via the FURS opis, and has the INR exception. Applied inline.
- *Purchase rows (§8):* the usmeritve (Last-Modified 2023-06-20) list prefill data as "transakcije o pridobitvah, ki zapirajo transakcije odsvojitve (ne glede na leto)". A separate control-data level (KpdData) also reports all of the past year's purchases, but it is not used for prefill.
- *Deadline (§8):* non-residents must file within 15 days of the disposal unless they report the whole year. Applied inline.
- *Rates (§8):* the base rate was 27.5% in 2020–2021. One web summary claimed a 2026 rise to 27.5%; the current FURS opis contradicts it, so treat that summary as wrong. zakonodaja.com still shows a superseded consolidated text (NPB24).
- *Booleans (§7):* the `YesNo` comparison is case-insensitive, `1` displays as "Ne", and `xs:boolean` rejects `TRUE`. Applied inline.
- *Import merge (§9):* the help page says nothing about short or PLVPZOK lists, or about the merge key. Applied inline.
- *InventoryListType (§5.1):* the XSD does not state the mapping to body elements; it follows from the annotations and the usmeritve.
- *Root element (§3):* the help page's `Doh_KDVP_Data` contradicts the XSD and is a legacy leftover.

## Open questions

- Which key does eDavki use to merge an imported PLVP list with an existing one: ISIN, Code, Name, or a combination? (The help page does not say; §9.)
- Does eDavki reject an import when `edp:taxpayer/edp:taxNumber` differs from the logged-in user's tax number?
- Which `DocumentWorkflowID` values besides `O` does Doh-KDVP accept? The generic eDavki list is O, B, R, P, I, V, Z, S, and ib-edavki suggests `I` for test calculations.
- Is F5 (inheritance/gift tax paid) a total for the row or a per-unit amount? The wording implies a total.
- Does the 28 Feb 2027 deadline (a Sunday) roll over to Monday 1 Mar 2027 under ZUP rules for eDavki submissions? (The 2026 precedent says yes; §8.)
- FURS legends conflict for transfers from INR to a trading account: code K on PLVP lists but code I on PLVPGB lists (2026+). Which is correct for PLVPGB?
- Is there a maximum file size or row count for eDavki XML import? None is published; anecdotally about 1,550 lots were accepted.
- No written FURS rule was found for representing stock splits; restating pre-split rows is community practice. Is that acceptable to FURS, or is a separate row expected?
- Should `IsFond` be true for UCITS ETFs (investicijski kuponi)? Tools differ. It changes the list label and the code-K legend, not the tax.
- Does eDavki recompute F8 itself on import? One Trading 212 tool writes `F8=0` everywhere and reportedly works.
- Is the root element `Doh_KDVP_Data` mentioned in the help page a legacy leftover? Evidence: no such schema exists, and the same sentence appears in the D-IFI help. (The verifier agrees; §3.)

## Sources

- [Doh_KDVP_9.xsd (live official schema)](https://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd)
- [EDP-Common-1.xsd (eDavki common envelope types)](https://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd)
- [Doh_KDVP_9.23 display XSLT (official labels and code legends per year)](https://edavki.durs.si/Documents/Transforms/Doh_KDVP_9.23-display-sl.xslt)
- [eDavki - Seznam obrazcev / XML sheme (FormsXml)](https://edavki.durs.si/EdavkiPortal/OpenPortal/Pages/Technicals/FormsXml.aspx)
- [Navodilo za izpolnjevanje Doh-KDVP (tax year 2025+), SL](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.n.sl.pdf)
- [Doh-KDVP form (tax year 2025+), EN](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.i.en.pdf)
- [eDavki help - Uvoz popisnih listov vrednostnih papirjev](https://edavki.durs.si/EdavkiPortal/PersonalPortal/[360253]/Pages/Help/sl/Documents_Doh_KDVP_PopisniListi.htm)
- [eDavki help - Doh-KDVP](https://edavki.durs.si/EdavkiPortal/PersonalPortal/[360253]/Pages/Help/sl/Documents_New_Doh_KDVP.htm)
- [eDavki help - Uvoz dokumenta](https://edavki.durs.si/EdavkiPortal/PersonalPortal/[360253]/Pages/Help/sl/Documents_Import.htm)
- [eDavki help - Vrste dokumentov (WorkflowType)](https://edavki.durs.si/EdavkiPortal/PersonalPortal/[360253]/Pages/Help/sl/WorkflowType1.htm)
- [eDavki - Uvoz podatkov iz spletnih aplikacij (web import POST)](https://edavki.durs.si/EdavkiPortal/OpenPortal/CommonPages/Opdynp/PageD.aspx?category=technicals_webimport)
- [eDavki - Napoved dohodnine od dobička od VP (form page)](https://edavki.durs.si/EdavkiPortal/OpenPortal/CommonPages/Opdynp/PageD.aspx?category=vrednostni_papirji_drugi_delezi_investicijski_kuponi)
- [FURS - Obresti, dividende, dobiček iz kapitala in dohodek z INR (15th ed., Aug 2026)](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Obresti_dividende_in_dobicek_iz_kapitala.doc)
- [FURS - Usmeritve pri dostavi podatkov KP-KDVP](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Usmeritve_pri_dostavi_podatkov_KP-KDVP.docx)
- [jamsix/ib-edavki source (ib_edavki.py)](https://github.com/jamsix/ib-edavki/blob/master/ib_edavki.py)
- [ib-edavki PR #213 (F8 violations, ISIN-changing splits)](https://github.com/jamsix/ib-edavki/pull/213)
- [ib-edavki issue #176 (eDavki schema error message format)](https://github.com/jamsix/ib-edavki/issues/176)
- [ib-edavki issue #155 (eDavki non-critical warnings)](https://github.com/jamsix/ib-edavki/issues/155)
- [MarjanDB/brrr-generator XmlDohKdvp.ts](https://github.com/MarjanDB/brrr-generator/blob/main/lib/src/TaxAuthorities/Slovenia/ReportGeneration/Kdvp/XmlDohKdvp.ts)
- [Neophytez/t212-edavki main.py](https://github.com/Neophytez/t212-edavki/blob/main/main.py)
- [masbug/etoro-edavki](https://github.com/masbug/etoro-edavki)
- [Wayback Machine history of Doh_KDVP_9.xsd](https://web.archive.org/web/2026*/https://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd)
- [ECB Data API - EXR USD/EUR reference rates (for example values)](https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata)
- [Zakon o individualnih naložbenih računih (ZINR) - PISRS](https://pisrs.si/pregledPredpisa?id=ZAKO9154)

Also cited during verification:

- [Doh-KDVP form (tax year 2025+), SL](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_kdvp_25.i.sl.pdf)
- [Wayback Machine CDX index of Doh_KDVP_9.xsd snapshots](https://web.archive.org/cdx/search/cdx?url=edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd&output=json&collapse=digest)
- [GOV.SI news 2026-01-26: javni pozivi k vložitvi napovedi do 2. marca 2026](https://www.gov.si/novice/2026-01-26-javni-pozivi-k-vlozitvi-napovedi-do-2-marca-2026/)
