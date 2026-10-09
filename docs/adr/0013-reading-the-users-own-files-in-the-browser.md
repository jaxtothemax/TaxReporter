# 13. Reading the user's own files in the browser

**Date:** 2026-10-08
**Status:** Proposed

> **Implementation status (2026-10-09):** built on branch `feat/web-own-files`, not yet on
> `main`: `packages/pipeline/src/prepare.ts` and, in `apps/web/src/`, `engine/` (`protocol.ts`,
> `handle.ts`, `toPreview.ts`, `lockdown.ts`, `engine.worker.ts`, `client.ts`, `rates.ts`),
> `i18n/present.ts`, `state/wizard.ts` and the four step screens. Tested in Node over the
> synthetic broker fixtures and in a headless browser against the dev server and the
> production build; no real export has been read in the browser yet.

## Context

The command line already turns Trading 212 and Interactive Brokers exports into Doh-KDVP and
Doh-Div (ADR 0011, ADR 0012). The web app, which most users will meet first, still shows only
a demo. Maja will not install a command line; Mojca will not upload a client's statement to a
server. Doing the same work in the browser raises questions the command line never had: a
64 MiB export must not freeze the page, nothing read from a file may reach the page's DOM or
the network, the answer the user gets must be the one the command line gives for the same
files, and Doh-Div needs details about each payer that no export holds. The architecture
review that should have shaped this was cut short by usage limits; the decisions below were
made from the threat model of 2026-10-08, ADR 0002, ADR 0011 and the VoC panel's must-haves,
and are open to review.

## Decision

1. **One pipeline, two shells.** `prepareReturns` moves from `apps/cli` into a new package,
   `@taxreporter/pipeline`: intake of every file, `validateLedger`, the coverage end, both
   builders. It is platform-neutral like `core` (no Node.js built-in, no DOM) and is the only
   way either app turns files into returns, so the same files give the same XML in both. It
   also exposes `readExports`, the first half on its own, for the screens that come before
   the taxpayer's details are known: nothing that needs a tax number runs without one, and no
   placeholder taxpayer exists anywhere.
2. **Files are read in a dedicated module worker**, never on the page. The worker owns the
   pipeline, the rate snapshot and the XML writers; the page owns only display. A long read
   leaves the page responsive, and a worker has no DOM, so no text from a file can be
   rendered except through the one reply shape the page checks.
3. **The worker runs under the page's policy, and locks itself down besides.** Two layers:
   - **The policy.** A worker loaded from its own URL takes its Content Security Policy from
     the headers its script is served with, and GitHub Pages sends none: it would run with no
     policy at all, `eval` and every other origin open. So the page starts the worker from a
     `blob:` bootstrap whose only statement imports the bundled engine; a worker from a local
     scheme inherits the page's policy (`worker-src 'self' blob:`). Under it, `eval` and any
     request to another origin, by `fetch`, `import()` or a font, are refused by the browser,
     however they are made.
   - **The lockdown.** As its first import, before any other module runs, the worker replaces
     `fetch`, `XMLHttpRequest`, `WebSocket`, `WebSocketStream`, `EventSource`, `WebTransport`,
     `importScripts`, `FontFace`, `fonts`, `indexedDB`, `caches`, `navigator` (and with it the
     origin's private file system), the legacy file-system calls, `BroadcastChannel`, `Worker`
     and `SharedWorker` with undefined, on its scope and on every prototype up the chain that
     defines them (Chromium keeps most on `WorkerGlobalScope.prototype`, where a property on
     the scope alone would only hide them), and refuses to start if any level still holds one.
     This closes the same origin too, and storage, which the policy does not.
   No list can name every way out, and `import()` is syntax, not a property: the policy is
   what holds; the lockdown narrows what is left to the module loader and the reply channel.
   The rate snapshot arrives as bundled same-origin modules (`?raw` imports, ADR 0005).
4. **A versioned protocol, checked on both sides.** Every message carries `v: 1`, a request
   ID and a kind. The worker answers only well-formed requests; the page drops any reply that
   is not well-formed, not of this version, or not for the latest request (a stale read after
   the user removed a file). Nothing but plain data crosses: amounts, rates and quantities as
   decimal strings (ADR 0006), never a `Decimal` or any class. An internal error crosses as a
   bare `failed`, with no message, since a message could carry file text.
5. **Two requests, one at a time.** `read` runs on every change to the file set or the account
   answer and returns, per file, its broker and the days it covers, or why it was refused,
   plus the ledger's findings and the dividend payers to ask about. `prepare` runs when the
   review opens, with the taxpayer and payer details, and returns the review's figures and
   both forms' XML. Each request carries every file's bytes: the worker keeps nothing between
   requests, so there is no cache to go stale and a reply is a function of its request. A
   newer request makes any older one stale, so the worker still busy with it is ended rather
   than left to hold a second copy of every file. A reply carries at most 500 findings,
   blocking ones first, and counts the rest; whether a form is withheld is decided over all of
   them.
6. **Files are bounded before a byte is read, then stay in memory.** A file that is not CSV
   or XML, is larger than `LIMITS.fileBytes`, or would take the session past
   `LIMITS.sessionBytes` is refused unread, and no more than `LIMITS.filesPerSession` files
   are listed. The bytes of the rest are read with `File.arrayBuffer()` when the engine first
   needs them and live only in the page's memory, as long as the tab does; nothing is written
   to storage. Because a reload loses them, the page asks before unloading while own files are
   loaded. Removing a file, choosing the demo or starting over drops its bytes.
7. **The account question is asked where it arises.** With two or more Trading 212 files,
   whose exports do not name their account, the Files step asks whether they come from one
   account, preset to one (ADR 0011 §4); changing the answer re-reads in place. Interactive
   Brokers files name their accounts and are never asked about.
8. **Payers are asked for, never looked up.** Doh-Div needs each payer's name, address and
   country (research 02 §3). The Details step lists every security that paid a dividend in
   the tax year, with the payer's name preset to the security's name in the export and the
   country to the one its ISIN names, where FURS lists it; the address, and the payer's ID if
   the user knows it, are typed in. Nothing is fetched to fill them: a lookup would tell a
   server which securities the user holds. A shipped payer directory may preset more later.
9. **A blocking finding stops the form it bears on, not both.** A missing payer address
   withholds Doh-Div and leaves Doh-KDVP ready; a finding from reading the files, which can
   bear on either, withholds both. The review lets the user continue while either form can be
   written, and the download step names each withheld form and why.
10. **Findings reach the page as codes, and become sentences there.** A finding crosses as its
    code, severity and parameters: a file as its position in the request, never its name;
    file text only inside `UntrustedText`. The page names files and words the parameters in
    the user's language from one catalog (`apps/web/src/i18n/findings.ts`), so changing the
    language needs no new read. File text is shown as React text, never as markup, and
    without the control, bidirectional and other format characters that would make it display
    as something it is not; a symbol is named beside an ISIN only when it looks like a ticker.

## Consequences

- **The command line and the browser cannot drift.** A fix to intake, the ledger or a builder
  lands in both, and one test suite covers the pipeline both call.
- **The demo is not yet on this path.** It still renders a fixed preview and writes its XML
  from a fixed ledger. Moving it onto bundled synthetic exports read by the same worker would
  make the demo a true run of the product; that is a follow-up, not part of this decision.
- **The worker cannot be unit-tested in jsdom.** The worker file stays a thin shell around a
  pure `handleRequest`, which is tested in Node with the broker fixtures; the page takes the
  engine as a dependency, so the screens are tested with a fake.
- **A session costs its files' size twice while a request runs:** the page holds the bytes,
  and the one request in flight holds a copy. The session cap bounds both; transferring
  instead of copying would need the page to re-read files for each request.
- **The worker's start depends on `blob:` workers**, which every current browser supports;
  a browser that refused one would show the files as unreadable rather than read them
  without the policy.
- **Typing payer addresses is real work** for an investor with many dividend payers, until a
  payer directory ships.
- **Unload warnings are coarse:** browsers show their own text, not ours.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0013`
- [ ] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Record the count here, **including zero**.
