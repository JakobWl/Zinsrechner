export function compareSemver(a: string, b: string): number {
  const parts = (value: string) =>
    value.replace(/^v/, "").split(".").map(Number);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const difference = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

// Treat missing or changed catalog data as unconfirmed availability.
export function latestStoreVersion(
  catalog: unknown,
  architecture: string,
): string | undefined {
  const data = catalog as {
    Product?: {
      DisplaySkuAvailabilities?: Array<{
        Sku?: {
          Properties?: { Packages?: Array<{ PackageFullName?: unknown }> };
        };
      }>;
    };
  } | null;
  const skus = data?.Product?.DisplaySkuAvailabilities;
  if (!Array.isArray(skus)) return undefined;
  const arch = architecture === "ia32" ? "x86" : architecture;
  let latest: string | undefined;
  for (const sku of skus) {
    const packages = sku?.Sku?.Properties?.Packages;
    if (!Array.isArray(packages)) continue;
    for (const pkg of packages) {
      if (typeof pkg?.PackageFullName !== "string") continue;
      const match =
        /^Wideve\.U\.BBGZinsrechner_(\d+\.\d+\.\d+\.\d+)_(x64|x86|arm64|neutral)__svv3hhfbxqbc8$/.exec(
          pkg.PackageFullName,
        );
      if (!match || (match[2] !== arch && match[2] !== "neutral")) continue;
      if (!latest || compareSemver(match[1], latest) > 0) latest = match[1];
    }
  }
  return latest;
}
