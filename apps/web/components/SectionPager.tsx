"use client";

import { Children, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * Switch dense dashboard sections in place: on wide screens the page stays one screen high and each view fills the
 * space under the tabs. `lead` (the module tabs) shares the tab row; a single view shows no view tabs.
 */
export default function SectionPager({ labels, lead, children }: { labels: string[]; lead?: ReactNode; children: ReactNode }) {
  const views = Children.toArray(children);
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const index = Math.min(active, views.length - 1);
  return <section className="section-pager" aria-label="内容切换">
    <div className="section-pager-bar">
      {lead}
      {views.length > 1 && <div className="section-pager-tabs" role="tablist" aria-label="切换内容">
        {views.map((_, i) => <button type="button" key={i} role="tab" aria-selected={index === i} className={index === i ? "on" : ""} onClick={() => setActive(i)}>
          <i className="num">{String(i + 1).padStart(2, "0")}</i><span>{labels[i] || `视图 ${i + 1}`}</span>
        </button>)}
      </div>}
    </div>
    <motion.div key={index} className="section-pager-view" role="tabpanel" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
      {views[index]}
    </motion.div>
  </section>;
}
