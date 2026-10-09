---
title: Privacy and security
description: What your broker files contain, why TaxReporter will process them only on your device, what the optional AI check would send, and how to report a security problem.
---

Broker statements and tax returns are some of the most personal data you have. TaxReporter is
designed so that this data never leaves your device. TaxReporter has no release yet, so this
page describes how it is being built. You can [run it from source](/guides/run-from-source/) to try it, as a draft to check.

## What your files contain

**Broker exports** can include, depending on the broker:

- your name, address and account number;
- order and transaction IDs;
- every trade, with its date, security, quantity and price;
- dividends and the tax withheld from them;
- deposits, withdrawals and cash balances.

**The XML files TaxReporter produces** will contain your tax number and name, and the details
of every sale and dividend you report.

Together they give a detailed picture of your finances. That is why TaxReporter will never ask
you to upload them.

## Why everything runs on your device

- **No server.** TaxReporter has no backend. The browser app will be a set of static files:
  once loaded, it will read your files inside your browser and build the XML there. The
  command-line tool will work the same way on your computer.
- **No accounts, no analytics, no telemetry.** There will be nothing to sign up for, and the
  app will not report how you use it.
- **Almost no network requests.** The app will include Banka Slovenije's exchange rates, which
  are the same for everyone and contain nothing about you, so loading the app will be the only
  request it needs. The only other request will be the optional AI check described below,
  and only if you turn it on. The code that reads your files will never use the network.
- **Nothing saved behind your back.** What you load will stay in memory while the app is open.
  Nothing will be stored unless you choose to save or download a file.
- **Checked by a test.** The plan includes an automated test that fails if the app makes any
  network request while it imports files.

You do not have to take this on trust. The source code is public, and your browser's developer
tools show every request a page makes.

If you prepare returns for clients, this also means their data is not handed to another
company.

## The optional AI check

A later version is planned to offer an optional "second opinion" from a large language model
(LLM). It could point out things that look odd, such as a sale with no matching purchase or an
unusual withholding rate. It is planned to work like this:

- **Off by default.** TaxReporter will work fully without it.
- **Your own API key.** You would use your own account with an AI provider. The project
  provides no key and runs no service in between. The first planned provider is Anthropic
  (Claude); others may follow.
- **A redacted summary, shown first.** Only a summary would be sent: figures per security,
  holding periods, the exchange rates used, and any problems found. Your tax number, name,
  address, and account and order numbers would never be included. You will see exactly what
  would be sent, and nothing goes out until you confirm.
- **Sent straight from your device** to the provider you chose. The provider's own terms and
  privacy policy apply to that request.
- **Advisory only.** The findings would appear as warnings next to TaxReporter's own results.
  They would never change a calculated number or the XML files.
- **Your key stays with you.** The browser app would keep it in memory, or save it in your
  browser only if you ask it to. The command-line tool would read it from an environment
  variable. It would never be logged.

## Reporting a security problem

If you find a security problem, for example a crafted broker file that makes TaxReporter run
code, send data somewhere, or write a wrong value into the XML, please report it privately.
**Do not open a public issue.**

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**, or go straight to
[the reporting form](https://github.com/jaxtothemax/TaxReporter/security/advisories/new). Only
you and the maintainers can see the report. Please include the steps to reproduce the problem,
and use made-up data instead of your real files.

## About this website

These pages are a static site hosted on GitHub Pages. The site itself uses no analytics, no
cookies and no third-party scripts. GitHub, as the host, processes visitors' IP addresses; see
the
[GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
