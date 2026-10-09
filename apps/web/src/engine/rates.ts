/**
 * The Banka Slovenije snapshot @taxreporter/fx ships, bundled as text and
 * loaded as modules when first needed, never fetched (ADR 0005): the first
 * screens stay light, and the engine worker can lock the network away.
 */
import { RateTable } from "@taxreporter/fx";

export async function loadRates(): Promise<RateTable> {
  const [daily, monthly, snapshot] = await Promise.all([
    import("@taxreporter/fx/data/bsi-daily.csv?raw"),
    import("@taxreporter/fx/data/bsi-monthly.csv?raw"),
    import("@taxreporter/fx/data/snapshot.json?raw"),
  ]);
  const { completeThrough } = JSON.parse(snapshot.default) as {
    readonly completeThrough: string;
  };
  return RateTable.fromCsv(daily.default, monthly.default, completeThrough);
}
