/**
 * Mock 数据集 —— 结构与 PRD §11 一致，可直接替换为真实接口数据
 *
 * ⚠️ 注意：章节名依据 2026 版教材重构后的框架整理（人力为三大部分 19 章）。
 *    正式内容上线前需教研以中国人事出版社 2026 版教材逐条校准（见 PRD Q10）。
 */
import type {
  AnswerLog,
  Confidence,
  ErrorReason,
  KnowledgeNode,
  MasteryLevel,
  PracticeMode,
  Question,
  QuestionType,
  SubjectId,
  UserKnowledgeState,
  UserQuestionState,
} from '@/domain/entities'

/* ==================== 知识树种子（真实章节名） ==================== */

interface ModuleSeed {
  id: string
  name: string
  weight: number
  chapters: string[]
}

/** 《经济基础知识》六大模块（PRD §1.1 R7 分值权重） */
export const ECON_MODULES: ModuleSeed[] = [
  {
    id: 'econ_m1',
    name: '经济学基础',
    weight: 29,
    chapters: [
      '市场需求、供给与均衡价格',
      '消费者行为分析',
      '生产和成本理论',
      '市场结构理论',
      '生产要素市场理论',
      '市场失灵和政府的干预',
      '国民收入核算和简单宏观经济模型',
      '经济增长和经济发展理论',
      '价格总水平和就业、失业',
      '国际贸易理论和政策',
    ],
  },
  {
    id: 'econ_m2',
    name: '财政',
    weight: 24,
    chapters: [
      '公共物品与财政职能',
      '财政支出',
      '财政收入',
      '税收制度',
      '政府预算',
      '财政管理体制',
      '财政政策',
    ],
  },
  {
    id: 'econ_m3',
    name: '货币与金融',
    weight: 22,
    chapters: [
      '货币供求与货币均衡',
      '中央银行与货币政策',
      '商业银行与金融市场',
      '金融风险与金融监管',
      '对外金融关系与政策',
    ],
  },
  {
    id: 'econ_m4',
    name: '统计',
    weight: 21,
    chapters: ['统计与数据科学', '描述统计', '抽样调查', '回归分析', '时间序列分析'],
  },
  {
    id: 'econ_m5',
    name: '会计',
    weight: 21,
    chapters: ['会计概论', '会计循环', '会计报表', '财务报表分析', '行政事业单位会计'],
  },
  {
    id: 'econ_m6',
    name: '法律',
    weight: 21,
    chapters: [
      '法律对经济关系的调整',
      '物权法律制度',
      '合同法律制度',
      '公司法律制度',
      '其他法律制度',
    ],
  },
]

/** 《人力资源管理》2026 新框架：三大部分 19 章（PRD §1.1-B） */
export const HR_PARTS: ModuleSeed[] = [
  {
    id: 'hr_p1',
    name: '第一部分 · 人力资源与社会保险政策',
    weight: 29,
    chapters: [
      '劳动合同管理与特殊用工',
      '社会保险法律',
      '社会保险体系',
      '劳动争议调解仲裁',
      '法律责任与行政执法',
      '宏观人力资源开发',
    ],
  },
  {
    id: 'hr_p2',
    name: '第二部分 · 人力资源管理专业理论',
    weight: 56,
    chapters: [
      '组织激励',
      '领导行为',
      '组织设计与组织文化',
      '劳动力市场理论',
      '工资与就业理论',
      '人力资本投资理论',
    ],
  },
  {
    id: 'hr_p3',
    name: '第三部分 · 人力资源管理实务',
    weight: 55,
    chapters: [
      '人力资源规划',
      '甄选',
      '培训与开发',
      '绩效管理',
      '薪酬管理',
      '劳动关系管理',
      '职业生涯管理',
    ],
  },
]

/** 各章节的考点种子（用于生成题目的题干与干扰项） */
const KNOWLEDGE_SEEDS: Record<string, string[]> = {
  // 经济基础
  市场需求供给与均衡价格: ['需求价格弹性', '供给规律', '均衡价格变动', '最高限价', '需求收入弹性'],
  消费者行为分析: ['无差异曲线', '预算约束线', '边际替代率', '消费者均衡', '收入效应与替代效应'],
  生产和成本理论: ['边际产量递减规律', '机会成本', '规模报酬', '短期成本曲线', '长期平均成本'],
  市场结构理论: ['完全竞争市场', '垄断竞争市场', '寡头垄断', '价格歧视', '市场集中度'],
  生产要素市场理论: ['引致需求', '劳动供给曲线', '工资的决定', '地租与准租金', '洛伦兹曲线'],
  市场失灵和政府的干预: ['外部性', '公共物品', '信息不对称', '逆向选择', '科斯定理'],
  国民收入核算和简单宏观经济模型: ['GDP核算方法', '消费函数', '乘数效应', '边际消费倾向', '投资乘数'],
  经济增长和经济发展理论: ['经济增长率', '索洛模型', '全要素生产率', '经济发展方式', '可持续发展'],
  价格总水平和就业失业: ['CPI', '通货膨胀类型', '菲利普斯曲线', '自然失业率', '奥肯定律'],
  国际贸易理论和政策: ['绝对优势理论', '比较优势理论', '要素禀赋理论', '关税效应', '倾销与反倾销'],
  公共物品与财政职能: ['公共物品特征', '资源配置职能', '收入分配职能', '经济稳定职能', '免费搭车'],
  财政支出: ['购买性支出', '转移性支出', '财政支出规模', '支出绩效评价', '瓦格纳法则'],
  财政收入: ['财政收入形式', '国债', '国有资产收益', '收费收入', '宏观税负'],
  税收制度: ['税收要素', '增值税', '企业所得税', '个人所得税', '税收负担转嫁'],
  政府预算: ['预算原则', '部门预算', '预算管理体制', '预算外资金', '国库集中收付'],
  财政管理体制: ['分税制', '转移支付', '事权与支出责任', '财政层级', '税收返还'],
  财政政策: ['扩张性财政政策', '紧缩性财政政策', '自动稳定器', '挤出效应', '政策时滞'],
  货币供求与货币均衡: ['货币层次划分', '货币需求动机', '货币乘数', '基础货币', '流动性陷阱'],
  中央银行与货币政策: ['存款准备金率', '再贴现', '公开市场业务', '货币政策中介目标', '常备借贷便利'],
  商业银行与金融市场: ['商业银行负债业务', '中间业务', '巴塞尔协议', '同业拆借市场', '票据市场'],
  金融风险与金融监管: ['信用风险', '系统性风险', '存款保险制度', '宏观审慎监管', '影子银行'],
  对外金融关系与政策: ['汇率制度', '国际收支平衡表', '外汇储备', '人民币国际化', '购买力平价'],
  统计与数据科学: ['总体与样本', '数据类型', '统计调查方式', '统计指标体系', '大数据特征'],
  描述统计: ['集中趋势测度', '离散程度测度', '标准差', '偏态与峰态', '箱线图'],
  抽样调查: ['抽样误差', '简单随机抽样', '分层抽样', '整群抽样', '样本量确定'],
  回归分析: ['一元线性回归', '最小二乘法', '判定系数', '显著性检验', '多重共线性'],
  时间序列分析: ['时间序列成分', '移动平均法', '指数平滑法', '季节变动', '趋势拟合'],
  会计概论: ['会计基本假设', '会计信息质量要求', '会计要素', '权责发生制', '会计计量属性'],
  会计循环: ['会计分录', '记账凭证', '账簿登记', '试算平衡', '期末账项调整'],
  会计报表: ['资产负债表', '利润表', '现金流量表', '所有者权益变动表', '报表附注'],
  财务报表分析: ['偿债能力分析', '营运能力分析', '盈利能力分析', '杜邦分析', '市盈率'],
  行政事业单位会计: ['国库集中支付', '零余额账户', '财政应返还额度', '事业基金', '非流动资产基金'],
  法律对经济关系的调整: ['法律关系构成', '经济法律责任', '代理制度', '诉讼时效', '法律行为'],
  物权法律制度: ['物权法定原则', '所有权', '用益物权', '担保物权', '善意取得'],
  合同法律制度: ['要约与承诺', '合同效力', '抗辩权', '违约责任', '合同保全'],
  公司法律制度: ['公司设立', '股东权利', '组织机构', '公司合并分立', '破产清算'],
  其他法律制度: ['反垄断法', '消费者权益保护', '知识产权', '劳动法', '招标投标法'],

  // 人力
  劳动合同管理与特殊用工: [
    '劳动合同订立',
    '试用期规定',
    '劳动合同解除情形',
    '经济补偿金',
    '劳务派遣',
    '非全日制用工',
    '劳动合同无法继续履行的判定',
  ],
  社会保险法律: ['社会保险法适用范围', '参保登记', '社保费征缴', '社保关系转移', '法律责任'],
  社会保险体系: [
    '基本养老保险',
    '城乡居民基础养老金最低标准',
    '基本医疗保险',
    '医保基金先行支付',
    '工伤保险',
    '工伤认定标准',
    '失业保险',
    '生育保险',
  ],
  劳动争议调解仲裁: ['劳动争议范围', '调解程序', '仲裁时效', '仲裁特殊处理情形', '一裁终局'],
  法律责任与行政执法: ['劳动保障监察', '行政处罚种类', '违法用工责任', '行政救济', '强制执行'],
  宏观人力资源开发: ['人力资本战略', '科技项目资金管理规范', '突出业绩奖励', '人才政策', '人力资源市场'],
  组织激励: [
    '需要层次理论',
    'ERG理论',
    '双因素理论',
    '三重需要理论',
    '公平理论',
    '期望理论',
    '强化理论',
    '内容型与过程型激励理论区分',
  ],
  领导行为: [
    '特质理论',
    '交易型与变革型领导',
    '魅力型领导',
    '路径-目标理论',
    '管理方格图',
    '生命周期理论',
    '领导技能与人际技能',
  ],
  组织设计与组织文化: [
    '组织设计类型',
    '职能制结构',
    '矩阵制结构',
    '事业部制',
    '组织文化类型',
    '学院型文化',
    '俱乐部型文化',
    '棒球队型文化',
    '堡垒型文化',
    '组织变革',
  ],
  劳动力市场理论: [
    '劳动力供给弹性',
    '劳动力需求弹性',
    '劳动力市场均衡',
    '劳动力流动',
    '就业与失业类型',
    '结构性失业',
  ],
  工资与就业理论: ['工资决定理论', '补偿性工资差别', '效率工资', '就业函数', '工资刚性'],
  人力资本投资理论: [
    '人力资本投资形式',
    '高等教育投资决策',
    '在职培训成本收益分摊',
    '一般培训与特殊培训',
    '内部劳动力市场',
  ],
  人力资源规划: ['需求预测方法', '供给预测', '德尔菲法', '人力资源供需平衡', '规划编制流程'],
  甄选: [
    '甄选方法信度与效度',
    '面试类型',
    '结构化面试',
    '评价中心',
    '传记资料分析',
    '背景调查',
  ],
  培训与开发: ['培训需求分析', '培训效果评估', '柯氏评估模型', '培训方法选择', '职业生涯发展'],
  绩效管理: [
    '战略性绩效管理',
    '绩效计划',
    '绩效评价方法',
    '关键绩效指标',
    '平衡计分卡',
    '绩效评价误区',
    '绩效反馈面谈',
  ],
  薪酬管理: [
    '战略性薪酬管理',
    '薪酬体系设计',
    '职位评价',
    '薪酬调查',
    '股权激励',
    '股票期权激励对象',
    '宽带薪酬',
  ],
  劳动关系管理: ['劳动关系三方机制', '集体协商', '员工参与', '劳动争议预防', '员工满意度'],
  职业生涯管理: ['职业生涯发展阶段', '职业锚', '职业通道设计', '继任计划', '职业倦怠'],
}

/* ==================== 知识树构建 ==================== */

export function buildKnowledgeTree(): KnowledgeNode[] {
  const nodes: KnowledgeNode[] = []
  const push = (n: KnowledgeNode) => nodes.push(n)

  const build = (subjectId: SubjectId, modules: ModuleSeed[]) => {
    modules.forEach((mod, mi) => {
      push({
        id: mod.id,
        subjectId,
        parentId: null,
        level: 1,
        name: mod.name,
        weight: mod.weight,
        examFreq: 0,
        stars: mod.weight >= 28 ? 5 : mod.weight >= 22 ? 4 : 3,
        order: mi,
      })
      mod.chapters.forEach((ch, ci) => {
        const chapterId = `${mod.id}_c${ci + 1}`
        const points = KNOWLEDGE_SEEDS[ch] ?? ['核心概念', '基本特征', '适用范围', '相关制度']
        push({
          id: chapterId,
          subjectId,
          parentId: mod.id,
          level: 2,
          name: `${ci + 1}. ${ch}`,
          weight: Number((mod.weight / mod.chapters.length).toFixed(1)),
          // 确定性伪随机：近 5 年考查次数 3-15（支撑「高频必刷」筛选）
          examFreq: 3 + ((mi * 7 + ci * 3) % 13),
          stars: 3,
          order: ci,
        })
        points.forEach((point, pi) => {
          push({
            id: `${chapterId}_k${pi + 1}`,
            subjectId,
            parentId: chapterId,
            level: 3,
            name: point,
            weight: 1,
            examFreq: 0,
            stars: 3,
            order: pi,
          })
        })
      })
    })
  }

  build('econ_base', ECON_MODULES)
  build('hr', HR_PARTS)
  return nodes
}

/* ==================== 题目生成 ==================== */

const STEM_TEMPLATES: Record<QuestionType, ((k: string) => string)[]> = {
  single: [
    (k) => `下列关于「${k}」的说法，正确的是（　）。`,
    (k) => `关于「${k}」，下列表述错误的是（　）。`,
    (k) => `「${k}」的核心特征是（　）。`,
    (k) => `在下列情形中，适用「${k}」的是（　）。`,
  ],
  multi: [
    (k) => `下列关于「${k}」的表述中，正确的有（　）。`,
    (k) => `「${k}」的主要影响因素包括（　）。`,
    (k) => `关于「${k}」，下列说法正确的有（　）。`,
  ],
  case: [
    (k) => `【案例】某公司在进行人力资源决策时，涉及「${k}」的适用问题。根据材料，下列说法正确的是（　）。`,
  ],
}

const OPTION_POOL = [
  '该概念仅在特定条件下成立，需同时满足法定要件',
  '属于强制性规定，当事人不得自行约定排除',
  '以主体资格合法为前提条件',
  '适用时应当遵循比例原则与必要性原则',
  '其效力可以追溯到行为发生之时',
  '仅在双方协商一致时方可适用',
  '应当以书面形式作出，否则不发生效力',
  '受法律保护，但不得损害第三人合法权益',
  '需经主管部门登记或备案后方可生效',
  '在符合条件时可以依法变更或解除',
]

/** 伪随机（固定种子，保证每次刷新数据一致） */
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const rand = seededRandom(20260903)

function pickOptions(correctCount: number): string[] {
  const pool = [...OPTION_POOL]
  const picked: string[] = []
  for (let i = 0; i < correctCount + 3 && pool.length > 0; i++) {
    const idx = Math.floor(rand() * pool.length)
    picked.push(pool.splice(idx, 1)[0])
  }
  return picked
}

export function buildQuestions(nodes: KnowledgeNode[], perKnowledgePoint = 2): Question[] {
  const questions: Question[] = []
  const knowledgePoints = nodes.filter((n) => n.level === 3)

  knowledgePoints.forEach((kp) => {
    const chapter = nodes.find((n) => n.id === kp.parentId)
    const siblingPoints = nodes
      .filter((n) => n.parentId === kp.parentId && n.id !== kp.id)
      .map((n) => n.name)

    for (let i = 0; i < perKnowledgePoint; i++) {
      // 每 5 道中出 1 道多选，案例型放在人力实务
      const isCase = kp.subjectId === 'hr' && kp.parentId?.includes('hr_p3') && i === 1
      const type: QuestionType = isCase ? 'case' : i % 3 === 0 ? 'multi' : 'single'
      const templates = STEM_TEMPLATES[type]
      const stem = templates[Math.floor(rand() * templates.length)](kp.name)

      const correctCount = type === 'single' ? 1 : 2 + Math.floor(rand() * 2)
      const optionTexts = pickOptions(correctCount)
      const options = optionTexts.slice(0, correctCount + 2).map((text, idx) => ({
        key: String.fromCharCode(65 + idx),
        content: text,
      }))
      const answer = options.slice(0, correctCount).map((o) => o.key)

      questions.push({
        id: `q_${kp.id}_${i}`,
        subjectId: kp.subjectId,
        type,
        stem,
        options,
        answer,
        difficulty: 1 + Math.floor(rand() * 5),
        bloomLevel: type === 'single' ? 'remember' : type === 'multi' ? 'understand' : 'apply',
        knowledgeNodeIds: [kp.id],
        explanation: {
          keyPoint: `本题考查「${kp.name}」${chapter ? `（${chapter.name}）` : ''}。`,
          perOption: options.map((o) => ({
            key: o.key,
            correct: answer.includes(o.key),
            text: answer.includes(o.key)
              ? `正确。${o.content}，符合「${kp.name}」的规定。`
              : `错误。该表述与「${kp.name}」的界定不符${
                  siblingPoints[0] ? `，更接近「${siblingPoints[0]}」的特征` : ''
                }。`,
          })),
          trapWords: type === 'single' ? ['错误的是', '正确的是'] : ['正确的有'],
          sourceRef: `2026版教材 · ${chapter?.name ?? ''}`,
        },
        // 可信度分布：官方为主，含少量 AI 生成（演示四级标签）
        sourceLevel: i % 11 === 0 ? 'B' : i % 5 === 0 ? 'A' : 'S',
        ownerType: i % 11 === 0 ? 'ai' : 'official',
        aiMetadata:
          i % 11 === 0
            ? {
                model: 'mock-llm',
                confidence: Number((0.72 + rand() * 0.2).toFixed(2)),
                verified: true,
                generatedAt: Date.now(),
              }
            : undefined,
        // 约 1/4 为真题，年份 2021-2025 轮转（支撑真题按年份演练）
        examYear: i % 4 === 0 ? 2021 + (Math.floor(i / 4) % 5) : undefined,
        contentVersion: '2026',
        status: 'active',
      })
    }
  })

  return questions
}

/* ==================== 用户状态生成（"有故事"的数据） ==================== */

/** 各模块掌握度设定：让热力图呈现合理强弱分布（PRD §7.3 mock 要求） */
const MODULE_MASTERY: Record<string, number> = {
  econ_m1: 78, // 经济学基础 良好
  econ_m2: 42, // 财政 薄弱
  econ_m3: 63, // 货币与金融 一般
  econ_m4: 71, // 统计 一般
  econ_m5: 31, // 会计 薄弱（最大失分项）
  econ_m6: 85, // 法律 掌握
  hr_p1: 55,
  hr_p2: 68,
  hr_p3: 47,
}

export function buildUserStates(nodes: KnowledgeNode[], questions: Question[]): UserQuestionState[] {
  const now = Date.now()
  const day = 86400000
  return questions.map((q, idx) => {
    const moduleId = q.knowledgeNodeIds[0].split('_c')[0]
    const mastery = MODULE_MASTERY[moduleId] ?? 60
    const r = rand()
    const isCorrect = r * 100 < mastery

    // 约 12% 的题目进入过学习流程，其余为未学
    const learned = idx % 8 === 0
    if (!learned) {
      return {
        questionId: q.id,
        fsrsDifficulty: 5,
        fsrsStability: 0,
        fsrsRetrievability: 0,
        dueAt: 0,
        lastReviewAt: null,
        reviewCount: 0,
        lapseCount: 0,
        conquerCount: 0,
        isWrong: false,
        isFavorited: false,
      }
    }

    const reviewCount = 1 + Math.floor(rand() * 4)
    const dueOffset = Math.floor(rand() * 5) - 1 // -1 ~ 3 天，含逾期与未来
    return {
      questionId: q.id,
      fsrsDifficulty: Number((3 + rand() * 4).toFixed(2)),
      fsrsStability: Number((1 + rand() * 20).toFixed(2)),
      fsrsRetrievability: Number((0.6 + rand() * 0.35).toFixed(3)),
      dueAt: now + dueOffset * day,
      lastReviewAt: now - Math.floor(rand() * 10) * day,
      reviewCount,
      lapseCount: isCorrect ? 0 : 1 + Math.floor(rand() * 2),
      conquerCount: isCorrect ? 1 + Math.floor(rand() * 2) : 0,
      isWrong: !isCorrect,
      isFavorited: idx % 37 === 0,
    }
  })
}

export function buildMastery(nodes: KnowledgeNode[]): UserKnowledgeState[] {
  const l2 = nodes.filter((n) => n.level === 2)
  return l2.map((ch) => {
    const moduleId = ch.id.split('_c')[0]
    const base = MODULE_MASTERY[moduleId] ?? 60
    const score = Math.max(0, Math.min(100, Math.round(base + (rand() * 20 - 10))))
    const level: MasteryLevel =
      score < 20 ? 'unlearned' : score < 45 ? 'weak' : score < 65 ? 'fair' : score < 82 ? 'good' : 'mastered'
    return {
      nodeId: ch.id,
      masteryScore: score,
      level,
      questionCount: 20 + Math.floor(rand() * 40),
      correctCount: Math.round((score / 100) * (20 + Math.floor(rand() * 40))),
      lastPracticeAt: Date.now() - Math.floor(rand() * 5) * 86400000,
      predictForgetAt: Date.now() + Math.floor(rand() * 7) * 86400000,
    }
  })
}

const CONFIDENCES: Confidence[] = ['sure', 'unsure', 'noidea']
const REASONS: ErrorReason[] = ['not_memorized', 'confused', 'misread', 'calc_error', 'no_idea']
const MODES: PracticeMode[] = ['review', 'chapter', 'special', 'real_exam', 'wrong', 'high_freq']

export function buildAnswerLogs(questions: Question[], count = 800): AnswerLog[] {
  const logs: AnswerLog[] = []
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    const q = questions[Math.floor(rand() * questions.length)]
    const moduleId = q.knowledgeNodeIds[0].split('_c')[0]
    const mastery = MODULE_MASTERY[moduleId] ?? 60
    const isCorrect = rand() * 100 < mastery
    logs.push({
      questionId: q.id,
      answeredAt: now - Math.floor(rand() * 90) * 86400000 - Math.floor(rand() * 86400000),
      userAnswer: isCorrect ? q.answer : q.options.filter((o) => !q.answer.includes(o.key)).slice(0, 1).map((o) => o.key),
      isCorrect,
      confidence: CONFIDENCES[Math.floor(rand() * 3)],
      durationMs: 15000 + Math.floor(rand() * 60000),
      mode: MODES[Math.floor(rand() * MODES.length)],
      errorReason: isCorrect ? undefined : REASONS[Math.floor(rand() * 5)],
    })
  }
  return logs.sort((a, b) => b.answeredAt - a.answeredAt)
}
