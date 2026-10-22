/** The five steps of the diagnosis closed loop (shared by the server page and the client step bar). */
export const LOOP_STEPS = [
  { key: "diagnose", no: "01", label: "问题诊断", question: "诊断什么、发现什么问题" },
  { key: "locate", no: "02", label: "定位溯源", question: "问题出在哪、是谁" },
  { key: "evaluate", no: "03", label: "对标评价", question: "与评价标准差多少" },
  { key: "strategy", no: "04", label: "策略生成", question: "针对问题做什么、能减多少" },
  { key: "effect", no: "05", label: "效果预测", question: "实施后能达到什么水平" },
] as const;
export type LoopStep = (typeof LOOP_STEPS)[number]["key"];
