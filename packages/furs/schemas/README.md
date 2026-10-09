# Vendored FURS eDavki XML schemas

The official XML schemas (XSD) that the Financial Administration of the Republic
of Slovenia (FURS) publishes for eDavki. They are vendored **byte-for-byte**:
never edit, reformat, or re-encode them. `packages/furs/src/index.test.ts`
asserts that every file below exists and that its SHA-256 still matches this
table.

| File               | Form                                       | Source                                                    | SHA-256                                                            |
| ------------------ | ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------ |
| `Doh_KDVP_9.xsd`   | Doh-KDVP (capital gains on securities)     | https://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd   | `c84c2208e2ad7098dd2594b54226308393df9aefb2c9184a81063ec8057967d5` |
| `Doh_Div_3.xsd`    | Doh-Div (dividends)                        | https://edavki.durs.si/Documents/Schemas/Doh_Div_3.xsd    | `9a78d1e56f3b964498002d559878cc7cf3058e51c772d04070a9a5c12e245ac3` |
| `Doh_Obr_2.xsd`    | Doh-Obr (interest)                         | https://edavki.durs.si/Documents/Schemas/Doh_Obr_2.xsd    | `3fd134e0a4ccf6af58d820f69a52b267c5a5f0f5434451d4ad9808201b1891a6` |
| `D_IFI_4.xsd`      | D-IFI (derivatives)                        | https://edavki.durs.si/Documents/Schemas/D_IFI_4.xsd      | `a82c97b60326c0b2b3452e9f9027350b484f50aab3254648229db80ccaf6eb4b` |
| `EDP-Common-1.xsd` | shared types, imported by every form above | https://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd | `51134b944aefb468e697c3ce61f3fa10bdf6ba4adc64bd9c29cb0fdf457f4ffd` |

All five were retrieved on **2026-10-06**. At a re-check on 2026-10-07 the
server reported `Last-Modified: Thu, 06 Aug 2026 10:27:41 GMT` for
`Doh_KDVP_9.xsd` and `Last-Modified: Fri, 19 Dec 2025 14:26:49 GMT` for
`EDP-Common-1.xsd`, serving the same bytes as the table above; no
`Last-Modified` was recorded for the other three.

## FURS edits these files in place

**FURS changes a published schema without bumping the version number in its file
name.** `Doh_KDVP_9.xsd` today is not guaranteed to be the `Doh_KDVP_9.xsd` of
last year, so the name is not an identity; the SHA-256 above is. A scheduled
drift check — fetch each source URL and compare its SHA-256 with this table — is
planned. Until it exists, a mismatch found by hand means: re-vendor the file,
update its row here in the same commit, and review the schema diff for changes
to the XML the writers must produce.

## Byte-exactness

- All five files use CRLF line endings. `Doh_KDVP_9.xsd` starts with a UTF-8
  byte-order mark; the other four have none.
- `.gitattributes` marks `packages/furs/schemas/*.xsd -text`, so git stores and
  checks them out exactly as downloaded instead of normalizing line endings.
- Every form schema imports `EDP-Common-1.xsd` through a relative
  `schemaLocation`, so the files must stay side by side in this directory.
- `EDP-Common-1.xsd` was downloaded twice, once with each form family; both
  copies had the same SHA-256, so one is vendored.
