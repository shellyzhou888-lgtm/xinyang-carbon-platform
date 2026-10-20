import geography from "@/data/park-geography.json";

export type Sector = "绿色家居" | "电子信息";
export type Position = [number, number];
export interface EnterpriseFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Position };
  properties: {
    kind: "enterprise"; code: string; name: string; sector: Sector; color: string;
    poiId: string; poiName: string; address: string; sourceUrl: string;
    precision: string; note: string; boundaryStatus: string;
  };
}
export interface DistributionFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: Position[][] };
  properties: { kind: "distribution"; code: string; name: string; sector: Sector; color: string; notLegalBoundary: boolean };
}
export const enterprises = geography.features.filter((feature) => feature.properties.kind === "enterprise") as unknown as EnterpriseFeature[];
export const distributions = geography.features.filter((feature) => feature.properties.kind === "distribution") as unknown as DistributionFeature[];
export { geography };
