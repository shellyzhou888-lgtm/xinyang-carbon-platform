"use client";

import { Children, useState, type ReactNode } from "react";

/** Switch dense dashboard sections in place, keeping the module's header and tabs visible. */
export default function SectionPager({ labels, children }: { labels: string[]; children: ReactNode }) {
  const views = Children.toArray(children);
  const [active, setActive] = useState(0);
  const index = Math.min(active, views.length - 1);
  return <section className="section-pager" aria-label="内容切换">
    <div className="section-pager-tabs" role="tablist" aria-label="切换内容">
      {views.map((_, i) => <button type="button" key={i} role="tab" aria-selected={index === i} className={index === i ? "on" : ""} onClick={() => setActive(i)}>{String(i + 1).padStart(2, "0")} <span>{labels[i] || `视图 ${i + 1}`}</span></button>)}
    </div>
    <div className="section-pager-view" role="tabpanel">{views[index]}</div>
  </section>;
}
