---
title: Contributing
description: How you can help TaxReporter, from reporting a broker format change to adding a broker or improving these pages.
---

TaxReporter is built in the open, and you do not need to be a tax expert to help. Most
contributions are bug reports, broker support, test files and documentation. The full
contributor guide is [CONTRIBUTING.md](https://github.com/jaxtothemax/broker-to-edavki/blob/main/CONTRIBUTING.md)
on GitHub; this page is a short overview.

:::caution[Never share real data]
Issues and pull requests are public. Never attach a real broker export or a generated tax
file, and never paste your tax number, account numbers or other personal details.
:::

## Report a broker export change

Brokers change their export formats without notice. If an export stops working, or looks
different from what TaxReporter expects,
[open an issue](https://github.com/jaxtothemax/broker-to-edavki/issues/new/choose) and:

1. Name the broker, the export type (for example "Trading 212 → History → Export CSV") and the
   date you exported it.
2. Paste **only the header row**. If it helps, add one or two rows in which every number,
   identifier and name has been replaced with made-up values.
3. Keep the real file to yourself. It holds your account details and your whole trading
   history.

## Add a broker adapter

An adapter reads one broker's export and turns it into TaxReporter's common list of events:
trades, dividends, withholding tax, fees and corporate actions. Exchange-rate conversion, FIFO
matching and the XML files are shared, so an adapter never has to deal with them. A new
adapter needs:

- detection by the file's header or structure, never by its file name;
- a made-up or anonymized test file for every known revision of the export format;
- every row accounted for: used, listed as ignored with a reason, or reported as a problem,
  never dropped silently;
- a short research note on where the format is documented and which fields can be trusted.

The details are under
[Adding a broker adapter](https://github.com/jaxtothemax/broker-to-edavki/blob/main/CONTRIBUTING.md#adding-a-broker-adapter)
in CONTRIBUTING.md. The [roadmap](/roadmap/#planned) lists the brokers people have asked for.

## Check the tax rules

Every rule TaxReporter applies is backed by a primary source: the law, FURS's instructions and
schemas, or Banka Slovenije. The sources are collected in the research notes in
[`docs/research/`](https://github.com/jaxtothemax/broker-to-edavki/tree/main/docs/research) on
GitHub, and a change to how any figure is calculated needs a primary source cited there. If
you know Slovenian tax rules well, reviewing those notes is one of the most useful things you
can do.

## Improve these pages

This site is written in Markdown in
[`website/src/content/docs/`](https://github.com/jaxtothemax/broker-to-edavki/tree/main/website/src/content/docs),
and every page has an **Edit page** link at the bottom. To preview a change on your own
computer (Node.js 22.12 or newer):

```sh
cd website
npm ci
npm run dev
```

A few rules keep the pages accurate:

- Write plain US English, and keep Slovenian terms such as *popisni list* as they are.
- Use the future tense for anything not yet listed as shipped on the [roadmap](/roadmap/).
- Link to other pages root-relative, such as `/roadmap/`. The build adds the site's base path.

## License

TaxReporter is free software under the
[GNU Affero General Public License v3.0 or later](https://github.com/jaxtothemax/broker-to-edavki/blob/main/LICENSE).
