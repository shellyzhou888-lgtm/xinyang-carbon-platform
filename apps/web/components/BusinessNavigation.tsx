import { LinkTabs } from "./MotionParts";

type Item = { key: string; label: string; href: string };

/** Every business feature stays in the same primary navigation, including the presentation highlights. */
export default function BusinessNavigation({ id, active, items }: { id: string; active: string; items: Item[] }) {
  return <div className="business-navigation">
    <LinkTabs id={id} label={id === "energy" ? "能源模块" : "碳排管理模块"} active={active} items={items} />
  </div>;
}
