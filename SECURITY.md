# Security policy

TaxReporter processes people's complete trading histories and produces files they submit to
the tax authority. Two kinds of problems count as security issues here:

- **Confidentiality:** anything that could make user data leave the user's device. This
  includes a network request carrying user data, data written somewhere the user did not
  choose, or a dependency phoning home.
- **Integrity:** anything that lets a crafted input file change the generated return in a way
  the user cannot see. Examples: a broker export that injects XML, executes code, exhausts
  memory, or silently alters another security's figures.

## Supported versions

TaxReporter is pre-1.0. Only the latest release and `main` receive fixes.

## Reporting a vulnerability

Please **do not open a public issue.** Use GitHub's private vulnerability reporting instead:
**Security** tab → **Report a vulnerability**. Include:

- what an attacker (or a malformed file) can achieve;
- the smallest reproduction you can make. Use a **synthetic** file; never send a real broker
  export or a real tax number;
- the version or commit you tested.

You can expect an acknowledgement within 7 days. Once a fix is released, the advisory is
published with credit to the reporter unless you prefer otherwise.

## Scope notes

- The optional LLM check sends a redacted summary to the provider the user configures, using
  the user's own key. A way to make it send more than the payload shown on the consent screen
  is in scope. The provider's own handling of data is not.
- Tax-calculation mistakes that do not involve a malicious input are ordinary bugs. Please
  report them as issues, without personal data.
