/**
 * 服务容器（应用层）
 *
 * 统一装配业务服务，业务服务只依赖 Repository 接口，不关心底层是 SQLite 还是 Mock。
 * 页面通过 getServices() 获取服务，页面内不再写任何业务规则。
 */
import { getDataSource } from '@/infrastructure'
import { AiService } from '@/domain/services/aiService'
import { BackupService } from '@/domain/services/backupService'
import { KnowledgeService } from '@/domain/services/knowledgeService'
import { MasteryService } from '@/domain/services/masteryService'
import { OnboardingService } from '@/domain/services/onboardingService'
import { PlanService } from '@/domain/services/planService'
import { getCapacityFactor } from '@/domain/services/planEngineService'
import { PredictionService } from '@/domain/services/predictionService'
import { SchedulerService } from '@/domain/services/schedulerService'
import { AdService } from '@/services/ads'
import { createAdAdapter } from '@/services/adAdapterFactory'

export interface Services {
  plan: PlanService
  mastery: MasteryService
  knowledge: KnowledgeService
  prediction: PredictionService
  backup: BackupService
  ai: AiService
  onboarding: OnboardingService
  scheduler: SchedulerService
  ads: AdService
}

let instance: Services | null = null

export function getServices(): Services {
  if (instance) return instance
  const ds = getDataSource()

  const plan = new PlanService({
    states: ds.states,
    mastery: ds.mastery,
    knowledge: ds.knowledge,
    plan: ds.plan,
    capacityFactor: getCapacityFactor,
  })

  const mastery = new MasteryService({
    mastery: ds.mastery,
    states: ds.states,
    questions: ds.questions,
    knowledge: ds.knowledge,
    answerLogs: ds.answerLogs,
  })

  const backup = new BackupService({ backup: ds.backup, states: ds.states })

  instance = {
    plan,
    mastery,
    backup,
    knowledge: new KnowledgeService({
      knowledge: ds.knowledge,
      mastery: ds.mastery,
      questions: ds.questions,
    }),
    prediction: new PredictionService({
      exams: ds.exams,
      mastery: ds.mastery,
      knowledge: ds.knowledge,
    }),
    ai: new AiService({ questions: ds.questions }),
    onboarding: new OnboardingService({
      questions: ds.questions,
      knowledge: ds.knowledge,
      mastery: ds.mastery,
      plan,
    }),
    scheduler: new SchedulerService({
      plan,
      mastery,
      backup,
      states: ds.states,
      planRepo: ds.plan,
    }),
    ads: new AdService(createAdAdapter()),
  }
  return instance
}

/** 数据源切换后需重置（如从 SQLite 降级到 Mock） */
export function resetServices() {
  instance = null
}

export {
  AiService,
  BackupService,
  KnowledgeService,
  MasteryService,
  OnboardingService,
  PlanService,
  PredictionService,
  SchedulerService,
  AdService,
}
export { sectionsOf, gradePaper, scoreOf, analyzeRegret, PASS_LINE } from '@/domain/services/examService'
export {
  BackupCryptoError,
  encryptBackup,
  decryptBackup,
  isEncryptedEnvelope,
  isCryptoAvailable,
  MIN_PASSWORD_LENGTH,
} from '@/domain/services/backupCrypto'
export { hasConsented, acceptConsent, revokeConsent, loadConsent } from '@/domain/privacy/consent'
export { isOnline, isOffline, onNetworkChange } from '@/domain/net/networkStatus'
export { schedule, retrievability, nextIntervalDays, initialState } from '@/domain/services/fsrs'
export { predictForgetAt } from '@/domain/services/masteryService'
export { EXAM_DATE } from '@/domain/services/planService'
