export type RuleCategoryId = "basics" | "betting" | "strategy" | "settlement";

export type RuleTopicId =
  | "game-flow"
  | "positions"
  | "actions"
  | "main-side-pots"
  | "all-in"
  | "incomplete-raise"
  | "pot-odds"
  | "effective-stack"
  | "showdown"
  | "odd-chips";

export interface RuleCategory {
  id: RuleCategoryId;
  label: string;
}

export interface RuleSection {
  title: string;
  paragraphs: string[];
  points?: string[];
}

export interface RuleTopic {
  id: RuleTopicId;
  category: RuleCategoryId;
  title: string;
  summary: string;
  keywords: string[];
  sections: RuleSection[];
  related: RuleTopicId[];
}

export const RULE_CATEGORIES: RuleCategory[] = [
  { id: "basics", label: "牌局基础" },
  { id: "betting", label: "下注规则" },
  { id: "strategy", label: "决策概念" },
  { id: "settlement", label: "摊牌结算" },
];

export const RULE_TOPICS: RuleTopic[] = [
  {
    id: "game-flow",
    category: "basics",
    title: "牌局流程",
    summary:
      "一手牌从盲注、发底牌开始，依次经过四轮行动并在无人可继续行动或摊牌后结算。",
    keywords: ["翻牌前", "翻牌", "转牌", "河牌", "行动顺序"],
    sections: [
      {
        title: "四轮行动",
        paragraphs: [
          "翻牌前每人获得两张底牌；随后依次发出三张翻牌、一张转牌和一张河牌。每次发公共牌前，上一轮下注必须完成。",
        ],
        points: [
          "翻牌前由大盲左侧仍在牌局中的玩家先行动。",
          "翻牌后由按钮位左侧仍在牌局中的玩家先行动。",
          "所有未弃牌玩家投入相同，或已经全下无法继续投入时，本轮结束。",
        ],
      },
      {
        title: "提前结束",
        paragraphs: [
          "如果只剩一名未弃牌玩家，该玩家直接赢得当前底池，不需要公开底牌。若仍有两名或以上玩家且已无后续行动，则发完公共牌并进入摊牌。",
        ],
      },
    ],
    related: ["positions", "actions", "showdown"],
  },
  {
    id: "positions",
    category: "basics",
    title: "位置与按钮位",
    summary:
      "按钮位决定盲注和行动顺序；越晚行动，通常能看到越多对手的公开选择。",
    keywords: ["庄家", "按钮", "小盲", "大盲", "位置"],
    sections: [
      {
        title: "按钮与盲注",
        paragraphs: [
          "D 标记代表按钮位。按钮左侧依次为小盲和大盲；每手结束后按钮移动到下一名仍在牌桌的玩家。",
        ],
        points: [
          "盲注属于强制投入，会计入该玩家本轮下注。",
          "单挑时按钮位同时支付小盲，翻牌前先行动、翻牌后后行动。",
          "多于两人时，按钮位通常在翻牌后最后行动。",
        ],
      },
      {
        title: "位置价值",
        paragraphs: [
          "后行动不是额外胜率，而是信息优势。你能先观察对手是否过牌、下注或加注，再决定自己的行动。",
        ],
      },
    ],
    related: ["game-flow", "effective-stack", "actions"],
  },
  {
    id: "actions",
    category: "betting",
    title: "行动与下注轮",
    summary: "可用行动由当前最高下注、你的已投入筹码和剩余筹码共同决定。",
    keywords: ["弃牌", "过牌", "跟注", "下注", "加注", "全下"],
    sections: [
      {
        title: "六类行动",
        paragraphs: ["操作区只会展示当前状态下合法的行动。"],
        points: [
          "弃牌：放弃争夺当前所有底池，已经投入的筹码不会退回。",
          "过牌：当前无需补齐筹码时把行动权交给下一位玩家。",
          "跟注：补齐到当前最高下注；筹码不足时会以全下方式跟注。",
          "下注：本轮尚无人投入时设定一个新的最高下注。",
          "加注：在已有下注上提高目标总额，输入框表示本轮累计总下注额。",
          "全下：投入全部剩余筹码，可能形成边池，也可能构成不足额加注。",
        ],
      },
      {
        title: "本轮何时结束",
        paragraphs: [
          "所有仍可行动的玩家都完成回应，且投入达到当前最高下注后，本轮才会推进。已经全下的玩家保留争夺资格，但不再获得行动权。",
        ],
      },
    ],
    related: ["all-in", "incomplete-raise", "game-flow"],
  },
  {
    id: "main-side-pots",
    category: "betting",
    title: "主池与边池",
    summary:
      "玩家全下金额不同时，筹码按每名玩家实际投入分层，分别形成主池和一个或多个边池。",
    keywords: ["主池", "边池", "底池", "全下", "分层"],
    sections: [
      {
        title: "形成方式",
        paragraphs: [
          "每个池只包含参与者共同覆盖的投入层。某玩家只能争夺自己有资格参与的池，不能赢取超过其投入层的筹码。",
        ],
      },
      {
        title: "例子",
        paragraphs: [
          "A 全下 100，B 投入 300，C 投入 300。主池为 300，三人均可争夺；边池为 400，仅 B 和 C 可争夺。A 即使牌型最好，也只能获得主池。",
        ],
      },
    ],
    related: ["all-in", "showdown", "odd-chips"],
  },
  {
    id: "all-in",
    category: "betting",
    title: "全下",
    summary:
      "全下是投入全部剩余筹码；筹码少于跟注额时仍可继续争夺自己覆盖的底池部分。",
    keywords: ["全下", "all-in", "筹码不足", "边池"],
    sections: [
      {
        title: "跟注全下",
        paragraphs: [
          "剩余筹码不足以完整跟注时，可以投入全部筹码。你不必补齐差额，但只能争夺按自己总投入形成的主池或对应边池。",
        ],
      },
      {
        title: "加注全下",
        paragraphs: [
          "全下金额达到最小加注要求时，它是完整加注并重新开放后续玩家的加注权；未达到时按不足额加注处理。",
        ],
      },
    ],
    related: ["main-side-pots", "incomplete-raise", "effective-stack"],
  },
  {
    id: "incomplete-raise",
    category: "betting",
    title: "不足额加注",
    summary:
      "玩家因全下提高了当前下注，但提高幅度小于上一笔完整加注时，属于不足额加注。",
    keywords: ["不足额", "最小加注", "重新开放", "加注权"],
    sections: [
      {
        title: "最小加注幅度",
        paragraphs: [
          "最小加注幅度通常等于本轮最近一次完整下注或完整加注所增加的数额。界面中的最小目标额已经按当前牌局状态计算。",
        ],
      },
      {
        title: "是否重新开放行动",
        paragraphs: [
          "不足额全下会提高其他玩家需要跟注的金额，但不会为已经对完整下注行动过的玩家重新开放再次加注权。尚未行动的玩家仍可进行完整加注。",
        ],
      },
    ],
    related: ["actions", "all-in", "main-side-pots"],
  },
  {
    id: "pot-odds",
    category: "strategy",
    title: "底池赔率",
    summary: "底池赔率表示跟注所需筹码占跟注后总底池的比例，可与估算权益比较。",
    keywords: ["底池赔率", "跟注", "权益", "胜率"],
    sections: [
      {
        title: "计算公式",
        paragraphs: [
          "底池赔率 = 跟注额 ÷（当前底池 + 跟注额）。例如底池 100、需要跟注 25，底池赔率为 25 ÷ 125 = 20%。",
        ],
      },
      {
        title: "如何理解",
        paragraphs: [
          "在不考虑后续下注、多人底池和估算误差时，若你的权益高于底池赔率，跟注具有正的即时筹码期望。游戏中的权益和 GTO 参考均为本地近似值，不是对隐藏牌的读取。",
        ],
      },
    ],
    related: ["effective-stack", "actions", "showdown"],
  },
  {
    id: "effective-stack",
    category: "strategy",
    title: "有效筹码与 SPR",
    summary:
      "有效筹码是参与双方中较小的可投入筹码；SPR 是有效筹码与当前底池的比值。",
    keywords: ["有效筹码", "SPR", "筹码深度", "底池"],
    sections: [
      {
        title: "有效筹码",
        paragraphs: [
          "你有 1,000、对手只有 300 时，双方在这手牌中最多互相赢取 300，决策的有效筹码因此是 300。多人底池应分别考虑仍有争夺关系的对手。",
        ],
      },
      {
        title: "SPR",
        paragraphs: [
          "SPR = 有效剩余筹码 ÷ 当前底池。较低 SPR 意味着剩余筹码相对底池较少，更容易在后续一到两次下注中全下；较高 SPR 会放大后续尺度与位置的重要性。",
        ],
      },
    ],
    related: ["pot-odds", "all-in", "positions"],
  },
  {
    id: "showdown",
    category: "settlement",
    title: "摊牌与牌型比较",
    summary:
      "最后一轮行动结束后，仍未弃牌的玩家以两张底牌和五张公共牌组成最佳五张牌。",
    keywords: ["摊牌", "牌型", "最佳五张", "平局"],
    sections: [
      {
        title: "最佳五张牌",
        paragraphs: [
          "可以使用两张、一道或零张底牌；系统会从七张可用牌中选择牌力最高的五张。比较顺序为皇家同花顺、同花顺、四条、葫芦、同花、顺子、三条、两对、一对、高牌。",
        ],
      },
      {
        title: "平局",
        paragraphs: [
          "若最佳五张牌完全相同，相关底池平均分配。花色不用于打破平局，未公开或已弃牌玩家的底牌不会在牌桌或复盘中泄露。",
        ],
      },
    ],
    related: ["main-side-pots", "odd-chips", "game-flow"],
  },
  {
    id: "odd-chips",
    category: "settlement",
    title: "余数筹码",
    summary:
      "底池不能被并列赢家整除时，先平均分配，剩余的最小筹码单位按固定座位顺序发放。",
    keywords: ["余数", "平分", "奇数筹码", "平局"],
    sections: [
      {
        title: "分配规则",
        paragraphs: [
          "每个主池或边池独立计算。整数筹码先平均分配，余数从按钮位左侧第一名有资格的赢家开始，按座位顺序逐枚发放。",
        ],
      },
      {
        title: "例子",
        paragraphs: [
          "101 筹码由两名玩家平分时，每人先得到 50，剩余 1 枚由按钮位左侧顺序中更靠前的合资格赢家获得。所有底池结算后总筹码保持守恒。",
        ],
      },
    ],
    related: ["showdown", "main-side-pots", "positions"],
  },
];

const topicsById = new Map(RULE_TOPICS.map((topic) => [topic.id, topic]));

export function getRuleTopic(topicId: string | null | undefined): RuleTopic {
  return topicsById.get(topicId as RuleTopicId) ?? RULE_TOPICS[0]!;
}

export function searchRuleTopics(
  query: string,
  category: RuleCategoryId | "all" = "all",
): RuleTopic[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  return RULE_TOPICS.filter((topic) => {
    if (category !== "all" && topic.category !== category) return false;
    if (!normalized) return true;
    return [
      topic.title,
      topic.summary,
      ...topic.keywords,
      ...topic.sections.flatMap((section) => [
        section.title,
        ...section.paragraphs,
        ...(section.points ?? []),
      ]),
    ]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(normalized);
  });
}
