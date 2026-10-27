import Link from "next/link";
import { LinkTabs } from "./MotionParts";

type Item = { key: string; label: string; href: string };

/** Keep everyday work prominent while retaining direct links to every specialist view. */
export default function BusinessNavigation({ id, active, items, topics }: { id: string; active: string; items: Item[]; topics: Item[] }) {
  return <div className="business-navigation">
    <LinkTabs id={id} label={id === "energy" ? "能源模块" : "碳排管理模块"} active={active} items={items} />
    <nav className="business-topics" aria-label="专题分析">
      <span>专题</span>
      {topics.map((item) => <Link key={item.key} href={item.href} className={active === item.key ? "on" : undefined} aria-current={active === item.key ? "page" : undefined} scroll={false}>{item.label}</Link>)}
    </nav>
  </div>;
}
