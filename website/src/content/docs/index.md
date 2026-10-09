---
title: TaxReporter
description: A free, open-source tool that will turn exports from foreign brokers into Doh-KDVP and Doh-Div files for FURS eDavki, without your data leaving your device.
# The site title is also "TaxReporter"; without this the tab would read "TaxReporter | TaxReporter".
head:
  - tag: title
    content: "TaxReporter: Doh-KDVP and Doh-Div files from foreign-broker exports"
---

TaxReporter is a free, open-source tool for Slovenian tax residents who invest through a
foreign broker. It will read the files you export from your broker and turn them into XML
files that you can import into FURS eDavki:

- **Doh-KDVP**, the return for gains from selling shares and ETFs
- **Doh-Div**, the return for dividends

Every amount will be converted to euros at the Banka Slovenije reference rate for the day of
the transaction, and you will be able to see which rate was used for each figure.

:::caution[Pre-alpha: no release yet]
TaxReporter is at an early stage of development and has no release yet. You can
[run it from source](/guides/run-from-source/) to try it, as a draft to check. These pages
describe what is being built, so you can follow along, comment, or help. Do not rely on
TaxReporter for a return you are filing now.
:::

## Why it exists

Foreign brokers such as Trading 212 and Interactive Brokers (IBKR) do not report to FURS, so
nothing is filled in for you. You have to list every purchase, sale and dividend yourself,
each converted at the Banka Slovenije rate for its own date. With a monthly savings plan, or a
few hundred trades a year, that means hours of careful copying, and one wrong rate or date
makes the return wrong.

## What it is, and what it is not

TaxReporter will:

- read your broker exports and convert every amount at the Banka Slovenije rate;
- match each sale to your earliest purchases of the same security ("first in, first out"),
  across all of your brokers and accounts;
- produce Doh-KDVP and Doh-Div files in the format eDavki imports, and show you where every
  number came from.

TaxReporter is **not**:

- **Tax advice.** It will help you prepare your returns, but you are responsible for what you
  submit. If your situation is unusual, ask a tax adviser or FURS.
- **Connected to FURS.** It is an independent community project. It is not affiliated with,
  reviewed or endorsed by FURS (Finančna uprava Republike Slovenije) or Banka Slovenije.
  Trading 212, Interactive Brokers and the other broker names on this site belong to their
  owners, and TaxReporter is not affiliated with them either.
- **A filing service.** It will never submit anything for you. You import the files into
  eDavki yourself, check them there, and decide whether to submit.

## Your data stays on your device

- **Local-first.** Everything will run on your own computer: in your web browser, or as a
  command-line tool. Your files will not be uploaded anywhere.
- **No accounts, no tracking.** There will be nothing to sign up for, and no analytics or
  telemetry.
- **No server with your data.** The project does not run a server that could receive, store
  or leak your statements.
- **An optional AI check, off by default.** A later version is planned to offer a "second
  opinion" from an AI model, using your own API key. It would send only a summary with your
  personal details removed, only after showing it to you, and it would never change a number.

The details are in [Privacy and security](/guides/privacy-and-security/).

## Who it is for

- **First-time filers** with a savings plan at Trading 212 who sold something during the year
  and do not want to type in hundreds of small purchases by hand.
- **Active investors** with hundreds of trades a year, often at more than one broker, who want
  sales matched correctly across all of them and a trail they can check.
- **Accountants** who prepare returns for private clients and want client data to stay on
  their own computer.
- **Developers** who want to add support for the broker they use.

Employees who sell shares from an employer's plan (RSUs or ESPP) will have to wait a little
longer: equity-plan platforms are on the [roadmap](/roadmap/#planned), but not in the first
version.

## Project status

- **Pre-alpha.** There is no release to install yet, but you can
  [run it from source](/guides/run-from-source/).
- **First version, v0.1, underway.** It will prepare Doh-KDVP and Doh-Div for tax year 2026
  from Trading 212, IBKR and Trade Republic exports. Returns for 2026 are due by 1 March 2027.
- **After that:** more brokers, the interest and derivatives returns, a Slovenian translation
  of these pages, and the optional AI check.

The [roadmap](/roadmap/) has the full list and is always the current word on what exists.

## Follow along or help

- [How it will work](/guides/how-it-will-work/): the planned steps from export to eDavki
- [Roadmap](/roadmap/): what is being built and what comes next
- [Source code on GitHub](https://github.com/jaxtothemax/broker-to-edavki)
- [Contributing](/contributing/): report a broker format change, add a broker, or improve
  these pages

TaxReporter is free software under the
[GNU Affero General Public License v3.0 or later](https://github.com/jaxtothemax/broker-to-edavki/blob/main/LICENSE)
(AGPL-3.0-or-later).
