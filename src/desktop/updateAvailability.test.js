import { describe, expect, it } from "vitest";
import { compareSemver, latestStoreVersion } from "./updateAvailability";

const catalog = (...names) => ({
  Product: {
    DisplaySkuAvailabilities: [
      {
        Sku: {
          Properties: {
            Packages: names.map((PackageFullName) => ({ PackageFullName })),
          },
        },
      },
    ],
  },
});
const pkg = (version, arch = "x64") =>
  `Wideve.U.BBGZinsrechner_${version}_${arch}__svv3hhfbxqbc8`;

describe("Store update availability", () => {
  it("does not advertise a submitted version while the catalog still serves the installed version", () => {
    const latest = latestStoreVersion(catalog(pkg("1.2.3.0")), "x64");
    expect(compareSemver(latest, "1.2.3")).toBe(0);
  });
  it("detects the update once the catalog publishes it", () => {
    const latest = latestStoreVersion(
      catalog(pkg("1.2.3.0"), pkg("1.2.4.0")),
      "x64",
    );
    expect(latest).toBe("1.2.4.0");
    expect(compareSemver(latest, "1.2.3")).toBeGreaterThan(0);
    expect(compareSemver(latest, "1.2.4")).toBe(0);
  });
  it("ignores incompatible packages and other package identities", () => {
    expect(
      latestStoreVersion(
        catalog(pkg("1.2.4.0", "arm64"), "Other_9.0.0.0_x64__svv3hhfbxqbc8"),
        "x64",
      ),
    ).toBeUndefined();
    expect(latestStoreVersion(catalog(pkg("1.2.4.0", "x86")), "ia32")).toBe(
      "1.2.4.0",
    );
  });
  it("keeps availability unconfirmed for missing or malformed responses", () => {
    for (const data of [
      null,
      {},
      { Product: { DisplaySkuAvailabilities: {} } },
      catalog(null, "bad-package"),
    ]) {
      expect(latestStoreVersion(data, "x64")).toBeUndefined();
    }
  });
});
