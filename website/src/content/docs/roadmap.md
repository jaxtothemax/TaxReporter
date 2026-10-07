---
title: Roadmap
description: What has shipped, what is being built now, and what is planned. Every other page on this site takes its tense from this one.
---

This page is the single source of truth for the status of each TaxReporter version. A feature
is described in the past or present tense anywhere on this site only once its version is listed
under **Shipped**. Until then, every page uses the future tense: "will", "planned for".

## Shipped

Nothing yet. TaxReporter has not had a release, and there is nothing to install.

## Underway

### v0.1: the first filing season (tax year 2026)

The goal of v0.1 is that a Slovenian tax resident with a Trading 212 account, an Interactive
Brokers account, or both, can prepare **Doh-KDVP** and **Doh-Div** for tax year 2026 and import
them into eDavki without errors. Returns for 2026 are due on 1 March 2027 (28 February 2027 is
a Sunday, so the deadline moves to the next working day), so v0.1 needs to be usable well before
then.

Planned scope:

- **Doh-KDVP:** gains from selling shares and ETFs, with sales matched "first in, first out"
  (FIFO) per security across all your brokers and accounts.
- **Doh-Div:** dividends, including the tax withheld abroad.
- **Brokers:** Trading 212 (CSV export) and Interactive Brokers (Flex Query report).
- **Exchange rates:** the Banka Slovenije daily and monthly lists, with the source, list date
  and rate kept next to every converted amount.
- **Browser app:** it will run on your device, with nothing uploaded, in Slovenian and English.
- **Command-line tool (CLI):** the same results, for scripts and repeatable runs.
- **FURS XML format:** files built to FURS's published schemas, with tests that check the output
  against them.

Not in v0.1: interest (Doh-Obr), derivatives (D-IFI), brokers other than Trading 212 and IBKR,
and the optional AI check.

## Planned

These come after v0.1. None of them has a version or a date yet, and the order may change
based on feedback.

- **More brokers:** eToro, Revolut, Robinhood, DEGIRO, XTB, Saxo, Lightyear and Trade Republic.
  Robinhood first needs research into how its EU stock tokens are taxed.
- **Equity-plan platforms** for shares from an employer's plan (RSUs and ESPP).
- **Doh-Obr:** interest, for example interest a broker pays on uninvested cash.
- **D-IFI:** derivatives such as options, futures and CFDs.
- **A Slovenian translation of this documentation site.**
- **An optional AI check:** a "second opinion" from an AI model using your own API key. It will
  be off by default, send only a redacted summary you have seen and approved, and never change
  a figure. See
  [Privacy and security](/guides/privacy-and-security/#the-optional-ai-check).

## Follow progress or ask for something

Work is planned and tracked in the project's
[GitHub issues](https://github.com/jaxtothemax/TaxReporter/issues). If your broker or your
situation is missing from this page, open an issue and describe it, without attaching any real
files. [Contributing](/contributing/) explains how.
