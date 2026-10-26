/**
 * 通话自动分类与打标
 *
 * 只依据转写文本与通话结果做规则判定，不调用外部模型：
 * 每条规则给出分类分数与命中证据，最高分作为分类结果，同时产出可解释的标签。
 */
import type { CallSegment } from "./types.js";

export interface ClassificationResult {
  category: string;
  score: number;
  summary: string;
  tags: string[];
  evidence: string[];
}

interface Rule {
  category: string;
  keywords: string[];
  summary: string;
  tags: string[];
}

const RULES: Rule[] = [
  {
    category: "报价咨询",
    keywords: ["报价", "价格", "多少钱", "单价", "折扣", "FOB", "CIF", "EXW", "quotation", "price", "discount"],
    summary: "客户在问价格与报价单",
    tags: ["价格敏感", "需要报价单"]
  },
  {
    category: "样品与打样",
    keywords: ["样品", "打样", "寄样", "sample", "颜色", "规格确认"],
    summary: "客户关心样品与规格打样",
    tags: ["需要样品"]
  },
  {
    category: "交期与物流",
    keywords: ["交期", "船期", "发货", "出运", "物流", "到哪", "生产进度", "delivery", "shipment", "ETA"],
    summary: "客户在跟交期与发运进度",
    tags: ["交期敏感"]
  },
  {
    category: "付款与账期",
    keywords: ["付款", "账期", "信用证", "L/C", "T/T", "预付", "定金", "payment", "deposit"],
    summary: "客户在谈付款方式与账期",
    tags: ["账期谈判"]
  },
  {
    category: "质量反馈",
    keywords: ["质量", "瑕疵", "不良", "客诉", "退货", "索赔", "quality", "complaint", "defect"],
    summary: "客户反馈质量问题，需要处理方案",
    tags: ["质量投诉", "需主管介入"]
  },
  {
    category: "合同与条款",
    keywords: ["合同", "条款", "签约", "PO", "订单确认", "contract"],
    summary: "客户在推进合同与订单条款",
    tags: ["推进签约"]
  }
];

const INTENT_HIGH = ["下单", "订单", "确认", "签", "采购", "需要", "想看", "希望", "要一版", "折扣"];

function joined(segments: CallSegment[]): string {
  return segments.map((segment) => segment.text).join(" ");
}

export function classifyCall(segments: CallSegment[], fallback: { category?: string; outcome?: string } = {}): ClassificationResult {
  if (!segments.length) {
    return {
      category: fallback.category || "未接通",
      score: 1,
      summary: fallback.outcome || "未产生有效对话",
      tags: ["未接通"],
      evidence: []
    };
  }

  const text = joined(segments);
  const scored = RULES.map((rule) => {
    const hits = rule.keywords.filter((keyword) => text.includes(keyword));
    return { rule, hits, score: hits.length };
  }).sort((left, right) => right.score - left.score);

  const best = scored[0];
  const totalHits = scored.reduce((sum, item) => sum + item.score, 0) || 1;
  const tags = new Set<string>();
  const evidence: string[] = [];

  if (!best || best.score === 0) {
    // 没有命中业务关键词：按对话热度给出"一般沟通/待跟进"
    const customerTurns = segments.filter((segment) => segment.speaker === "customer").length;
    const hot = customerTurns >= 2 || INTENT_HIGH.some((keyword) => text.includes(keyword));
    return {
      category: hot ? "一般沟通" : "简短沟通",
      score: 0.5,
      summary: fallback.outcome || (hot ? "客户有交流意愿，需明确下一步" : "通话较短，建议再确认需求"),
      tags: [...tags, hot ? "有意向待确认" : "需再联系"],
      evidence: []
    };
  }

  best.hits.forEach((hit) => evidence.push(`命中关键词「${hit}」`));
  best.rule.tags.forEach((tag) => tags.add(tag));

  // 意向强度：客户侧出现下单/确认类词
  const customerText = segments.filter((segment) => segment.speaker === "customer").map((segment) => segment.text).join(" ");
  if (INTENT_HIGH.some((keyword) => customerText.includes(keyword))) tags.add("意向明确");
  const customerTurns = segments.filter((segment) => segment.speaker === "customer").length;
  if (customerTurns >= 3) tags.add("沟通充分");
  if (segments.length <= 2) tags.add("需再联系");

  const score = Math.min(1, Number((best.score / totalHits + 0.35).toFixed(3)));
  return {
    category: best.rule.category,
    score,
    summary: fallback.outcome ? `${best.rule.summary}；${fallback.outcome}` : best.rule.summary,
    tags: [...tags],
    evidence
  };
}

/** 供 UI 展示分类字典 */
export const CALL_CATEGORIES = ["未接通", ...RULES.map((rule) => rule.category), "一般沟通", "简短沟通"];
