---
title: Exchange rates
description: Why TaxReporter will convert every amount at the Banka Slovenije reference rate for its own day, how it will choose the right rate list, and how the data is credited.
---

FURS wants every amount in euros. When you buy, sell or receive a dividend in another
currency, the amount has to be converted at the Banka Slovenije reference rate valid on that
day. This page explains the rule in plain language and how TaxReporter will apply it.

:::note
TaxReporter is not usable yet: this page describes how it will convert amounts once the first
version is ready. It is not tax advice.
:::

## The rule

The Personal Income Tax Act (*Zakon o dohodnini*, ZDoh-2) requires amounts in a foreign
currency to be converted into euros at the reference rate **published by Banka Slovenije**
that is valid on the day of the purchase, the sale or the income (Articles 16(6), 98(9) and
99(3)).

In practice that means:

- **Not your broker's rate.** Brokers convert currencies at their own rates, which are not the
  rates the law asks for. TaxReporter will not use them for tax figures.
- **Every transaction gets its own day's rate.** Shares bought in 2023 are converted at the
  rate for their purchase date, even if you sell them in 2026. The sale is converted at the
  rate for the sale date.
- **The right day.** For purchases and sales, that is the trade date (the day the trade was
  made), not the settlement date a few days later. For a dividend, it is the day the dividend
  was paid.

## How to read a Banka Slovenije rate

Banka Slovenije publishes its rates as a rate list (*tečajnica*). Each rate says how many units
of a foreign currency one euro is worth: a rate of 1.1702 for the US dollar means
1 EUR = 1.1702 USD. To convert an amount into euros, divide it by the rate.

For example, on Thursday 14 May 2026 the Banka Slovenije rate for the US dollar was 1.1702. A
dividend of 50.00 USD paid that day is:

| Step | Value |
|---|---|
| Dividend paid | 50.00 USD |
| Rate for that day | 1.1702 USD per EUR |
| In euros | 50.00 ÷ 1.1702 = 42.73 EUR |

TaxReporter will keep full precision while it calculates, and round only when it writes a
value into a form field, to the number of decimals that field takes.

## Weekends and holidays

Banka Slovenije does not publish a list on weekends, or on the holidays when the European
TARGET payment system is closed, such as Christmas Day. For those days, the rate comes from the
last list published **before** that day:

- A dividend paid on Saturday 25 October 2025 uses the list of Friday 24 October 2025.
- A dividend paid on Thursday 25 December 2025 uses the list of Wednesday 24 December 2025.

TaxReporter will look back at most ten days for a list; the longest real gap between two lists
is five days. If it still finds none, it will stop with an error instead of guessing.

## Currencies that are not on the daily list

The daily list covers the main world currencies. For many others, such as the Taiwan dollar
(TWD), the Argentine peso (ARS) or the UAE dirham (AED), Banka Slovenije publishes a monthly
list, and TaxReporter will use that. For example, the rate for the Taiwan dollar on
15 October 2025 came from the monthly list: 35.777 TWD per euro.

Prices of London-listed securities are often quoted in pence (GBX) rather than pounds.
TaxReporter will convert pence to pounds (100 pence = 1 GBP) before applying the rate for the
pound.

## Why not the ECB rate?

Banka Slovenije's daily list republishes the euro reference rates of the European Central Bank
(ECB), so the two usually match. They are not always identical: on a handful of days since 2007
they have differed, for example for the Norwegian krone on 23 October 2025. The law names Banka
Slovenije, so TaxReporter will use the Banka Slovenije list itself, never the ECB's numbers in
its place.

## Where TaxReporter will get the rates

Banka Slovenije publishes its lists on its website, but a web app on another site cannot
download them directly. So the project will publish its own copy of the Banka Slovenije daily
and monthly lists, with the values exactly as Banka Slovenije published them. An automated job
will refresh the copy every day and cross-check it against the ECB data.

The app will load this copy together with the app itself. It is the same for everyone and
contains nothing about you. If one of your transactions is more recent than the copy you have,
TaxReporter will tell you instead of quietly using another source.

Every converted amount will carry its provenance: the source, the date of the list it came from,
and the rate. You will see all three when you review your results.

## Attribution

Exchange-rate data: **Source: [Banka Slovenije](https://www.bsi.si/).** The data is reused,
with its values unchanged, under the Creative Commons Attribution 4.0 International license
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). TaxReporter is not affiliated with
or endorsed by Banka Slovenije.

The primary sources behind this page, including the law and the Banka Slovenije data files,
are collected in the project's
[research notes on GitHub](https://github.com/jaxtothemax/TaxReporter/tree/main/docs/research).
