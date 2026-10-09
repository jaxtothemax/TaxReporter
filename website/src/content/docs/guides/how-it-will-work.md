---
title: How it will work
description: The planned steps from a broker export to a submitted return in eDavki. None of these steps work yet.
---

:::note[Planned, not built yet]
This page describes how TaxReporter is meant to work once the first version (v0.1) is ready.
None of it works yet, and details may change while the app is being built. The
[roadmap](/roadmap/) shows the current status.
:::

The short version: you export your history from your broker, open the files in TaxReporter,
check what it found, download the XML files, and import them into eDavki, where you review the
return and submit it yourself.

## 1. Export your history from your broker

Download your transaction history as a file from every broker you use. For the first version
that will be:

- **Trading 212:** the CSV export of your account history.
- **Interactive Brokers (IBKR):** a Flex Query report. These pages will list exactly which
  sections and fields to turn on.
- **Trade Republic:** the transaction export (CSV), with all transactions. Its dividends, and
  trades with a foreign currency leg, will be read once a real export confirms how it writes
  them; until then such a row will stop both returns, with the reason.

Export your **whole history**, from the day you opened the account, not only the tax year.
Each sale is matched against your earliest purchases of the same security first ("first in,
first out", or FIFO), and those purchases may be years old. If TaxReporter cannot find the
purchases behind a sale, it will stop and ask for the missing exports instead of guessing.

If you hold the same security at more than one broker, export from all of them. FIFO applies
to everything you own of that security, across all your brokers and accounts, so the
holdings count as one.

## 2. Open the files in TaxReporter

You will be able to use TaxReporter in two ways:

- **In your web browser.** The app will be served from this website, but it will run entirely
  on your computer. Your browser reads the files; nothing is uploaded.
- **On the command line.** The command-line tool (CLI) will produce the same files as the
  browser app from the same input, for people who prefer scripts or need repeatable runs. At
  first you will run it from a copy of the source code.

You will also enter your tax number (*davčna številka*) and your name, because eDavki expects
them in the file. They stay on your device as well.

Trading 212 exports do not say which account they come from. If you add more than one,
TaxReporter will ask whether they are from one account (it assumes so until you say otherwise),
so that overlapping exports of one account are read once and separate accounts are all counted.
Every Trade Republic export will be taken for your one Trade Republic account, so add only
your own: one person's files per session.

For Doh-Div, eDavki needs the name, address and country of every company or fund that paid you
a dividend. TaxReporter will fill in the name and the country from your export where it can,
and you will type in the address. It will not look these details up online: that would tell a
server which securities you own. Until a payer's details are complete, Doh-Div will wait, while
Doh-KDVP will still be ready to download.

## 3. Review what TaxReporter found

Before you download anything, TaxReporter will show you what it read and how it arrived at
each figure:

- **Sales, per security:** each sale with the purchases it was matched to, and their dates,
  quantities and euro values.
- **Dividends:** each payment, with the tax already withheld abroad.
- **Exchange rates:** for every converted amount, the rate used and the date of the Banka
  Slovenije list it came from. [Exchange rates](/reference/exchange-rates/) explains how the
  rate is chosen.
- **Problems:** anything TaxReporter could not handle, with an explanation. Every row of your
  export will either be used, listed as ignored with a reason, or reported; nothing is dropped
  silently. A blocking problem, such as a corporate action TaxReporter does not support yet,
  stops the export until you resolve it.
- **An estimate of the tax:** clearly labeled as an estimate. FURS calculates the actual tax
  after you submit.

## 4. Download the XML files

TaxReporter will produce one file per return:

- **Doh-KDVP** for your sales of shares and ETFs
- **Doh-Div** for your dividends

The files will follow the XML format FURS publishes for importing these returns, and
TaxReporter's tests will check its output against FURS's schemas. A report listing every figure and where it
came from is also planned, so you can keep it with your records.

## 5. Import the files into eDavki

1. Log in to [eDavki](https://edavki.durs.si/).
2. Open **Dokumenti → Uvoz** (Documents → Import).
3. Choose one of the XML files and click **Uvozi dokument** (Import document). eDavki opens
   the return, filled in from the file.
4. Check the return in eDavki. Compare it with what TaxReporter showed you and with your
   broker statements, and read any warnings eDavki shows.
5. Submit the return in eDavki when you are satisfied. Then repeat the steps for the other
   file.

Keep your broker statements and the files TaxReporter produced: FURS can ask you to show where
a figure came from.

## When to file

Doh-KDVP and Doh-Div for a tax year are due by 28 February of the following year. When that
day falls on a weekend, the deadline has moved to the next working day: returns for 2025 were
due on 2 March 2026. For tax year 2026, 28 February 2027 is a Sunday, so the deadline is
expected to be Monday 1 March 2027. Check the date FURS announces before relying on it.

## What TaxReporter will not do

- **File or sign anything for you.** Only you can submit your return in eDavki.
- **Cover every return at first.** The first version will handle Doh-KDVP and Doh-Div only.
  Interest (Doh-Obr) and derivatives such as options and CFDs (D-IFI) are planned for later.
- **Cover every broker at first.** The first version will support Trading 212, IBKR and Trade
  Republic. The [roadmap](/roadmap/#planned) lists the brokers planned next.
- **Guess.** When TaxReporter does not understand something in your export, it will tell you.
