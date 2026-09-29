import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedEquipment, seedPlant } from '../data/seed'
import type {
  AcceptanceDefect, AcceptanceItem, AuditEntry, DeliveryPackage,
  EquipmentNode, InspectionStatus, PartyReply, Plant
} from '../types/domain'

const STORAGE_KEY = 'gsb67:grid-acceptance'
let idSeed = 30

interface ActionResult {
  ok: boolean
  message: string
  /** 复验初测通过但证据不足时使用：缺陷与签署仍被挡住 */
  blocked?: boolean
}

/** 签署后更正请求在工作区中留存，直到重新签署写入新交付版本 */
export interface CorrectionContext {
  reason: string
  fromVersion: number
  operator: string
  requestedAt: string
}

const FROZEN_MESSAGE = '当前交付版本已签署冻结，需先在“签署与审计”页申请更正并另存新版本'

/** reactive 代理无法被 structuredClone 克隆，业务数据均为可 JSON 序列化结构 */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useAcceptanceStore = defineStore('acceptance', () => {
  const plant = ref<Plant>(structuredClone(seedPlant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seedEquipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seedDefects))
  const audit = ref<AuditEntry[]>(structuredClone(seedAudit))
  const deliveries = ref<DeliveryPackage[]>([])
  const correction = ref<CorrectionContext | null>(null)
  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)

  const frozen = computed(() => plant.value.status === '已签署')
  const selectedEquipment = computed(() => equipment.value.find((item) => item.id === selectedEquipmentId.value))
  const currentDelivery = computed(() =>
    [...deliveries.value].sort((a, b) => b.version - a.version).find((item) => !item.superseded) ?? null
  )
  const stats = computed(() => {
    const items = equipment.value.flatMap((item) => item.items)
    return {
      total: items.length,
      passed: items.filter((item) => item.status === '合格').length,
      failed: items.filter((item) => item.status === '不合格' || item.status === '待复验').length,
      openDefects: defects.value.filter((item) => !['已关闭', '带条件通过'].includes(item.status)).length
    }
  })

  function defectLinkedItem(defect: AcceptanceDefect) {
    return equipment.value
      .find((node) => node.id === defect.equipmentId)
      ?.items.find((item) => item.id === defect.itemId) ?? null
  }

  /** 把缺陷复验/决定结果同步到对应验收项 */
  function syncItemFromDefect(defect: AcceptanceDefect, status: InspectionStatus, note: string) {
    const item = defectLinkedItem(defect)
    if (!item) return
    item.status = status
    item.syncNote = note
    item.version += 1
  }

  const preflight = computed(() => {
    const blocking: string[] = []
    const items = equipment.value.flatMap((item) => item.items)
    if (frozen.value) blocking.push('交付版本已签署冻结，更正需另存新版本')
    if (items.some((item) => item.status === '待检查')) blocking.push('仍有验收项未检查')
    if (items.some((item) => item.status === '不合格' || item.status === '待复验')) blocking.push('存在不合格或待复验项')
    if (defects.value.some((item) => !['已关闭', '带条件通过'].includes(item.status))) blocking.push('存在未闭环缺陷')
    defects.value
      .filter((item) => item.status === '带条件通过')
      .forEach((item) => {
        if (!item.reviewDate) blocking.push(`缺陷${item.id}带条件接受缺少复查日期`)
        else if (item.reviewDate < new Date().toISOString().slice(0, 10)) blocking.push(`缺陷${item.id}复查日期${item.reviewDate}已到期，需完成复查`)
      })
    if (equipment.value.flatMap((item) => item.certificates).some((item) => !item.verified)) blocking.push('存在未核验证书')
    const expired = equipment.value.flatMap((item) => item.certificates).some((item) => item.expiresAt < plant.value.commissioningDate)
    if (expired) blocking.push('证书在并网日期前失效')
    return { allowed: blocking.length === 0, blocking }
  })

  function hydrate() {
    if (!import.meta.client || hydrated.value) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        plant.value = stored.plant
        equipment.value = stored.equipment
        defects.value = stored.defects
        audit.value = stored.audit
        deliveries.value = Array.isArray(stored.deliveries) ? stored.deliveries : []
        correction.value = stored.correction ?? null
      }
    } catch {
      // Seed data is kept when browser storage is corrupt.
    }
    hydrated.value = true
  }

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      plant: plant.value, equipment: equipment.value, defects: defects.value,
      audit: audit.value, deliveries: deliveries.value, correction: correction.value
    }))
  }

  function log(entityId: string, action: string, operator: string, detail: string) {
    audit.value.unshift({
      id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail,
      createdAt: new Date().toISOString(), plantVersion: plant.value.version
    })
  }

  function updateItem(equipmentId: string, itemId: string, patch: Partial<AcceptanceItem>): ActionResult {
    if (frozen.value) return { ok: false, message: FROZEN_MESSAGE }
    const item = equipment.value.find((node) => node.id === equipmentId)?.items.find((value) => value.id === itemId)
    if (!item) return { ok: false, message: '验收项不存在' }
    const previous = `${item.status}/V${item.version}`
    Object.assign(item, patch, { version: item.version + 1 })
    // 人工录入视为对验收项的直接结论，清除缺陷回写标记
    delete item.syncNote
    log(equipmentId, '更新验收项', '当前用户', `${item.id}由${previous}更新为${item.status}`)
    persist()
    return { ok: true, message: `验收项${item.id}已保存为V${item.version}` }
  }

  function verifyCertificate(equipmentId: string, certificateId: string, verified: boolean): ActionResult {
    if (frozen.value) return { ok: false, message: FROZEN_MESSAGE }
    const certificate = equipment.value.find((node) => node.id === equipmentId)?.certificates.find((item) => item.id === certificateId)
    if (!certificate) return { ok: false, message: '证书不存在' }
    certificate.verified = verified
    certificate.version += 1
    log(equipmentId, verified ? '核验证书' : '取消证书核验', '当前用户', `${certificate.name} V${certificate.version}标记为${verified ? '已核验' : '待核验'}`)
    persist()
    return { ok: true, message: verified ? '证书已核验' : '证书已退回待核验' }
  }

  function assignDefect(id: string, owner: string): ActionResult {
    if (frozen.value) return { ok: false, message: FROZEN_MESSAGE }
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    defect.owner = owner
    defect.status = '整改中'
    defect.version += 1
    log(id, '分派缺陷', '验收负责人', `责任方调整为${owner}`)
    persist()
    return { ok: true, message: `缺陷已分派给${owner}` }
  }

  function addReply(id: string, reply: PartyReply): ActionResult {
    if (frozen.value) return { ok: false, message: FROZEN_MESSAGE }
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!reply.content || !reply.evidence) return { ok: false, message: '回复内容和证据均不能为空' }
    defect.replies.unshift(reply)
    defect.status = '待联合复验'
    defect.version += 1
    log(id, `${reply.party}提交处理说明`, reply.owner, reply.content)
    persist()
    return { ok: true, message: '已提交处理说明并进入联合复验' }
  }

  function addRetest(
    id: string,
    result: string,
    passed: boolean,
    evidence: string,
    evidenceSufficient: boolean
  ): ActionResult {
    if (frozen.value) return { ok: false, message: FROZEN_MESSAGE }
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!result.trim()) return { ok: false, message: '复验结果说明不能为空' }
    if (!evidence.trim()) return { ok: false, message: '复验证据附件不能为空' }

    const round = defect.retests.length + 1
    defect.retests.unshift({
      round, passed, result, evidence, evidenceSufficient,
      tester: '联合验收组', testedAt: new Date().toISOString()
    })
    defect.version += 1

    let message: string
    if (passed && evidenceSufficient) {
      // 合格且证据充分：缺陷关闭，结果回写验收项为合格，签署可继续
      defect.status = '已关闭'
      defect.decisionNote = `第${round}轮联合复验合格，证据充分，自动关闭`
      defect.reviewDate = undefined
      syncItemFromDefect(defect, '合格', `第${round}轮复验合格回写：${result}`)
      message = `第${round}轮复验合格，结果已回写验收项，缺陷关闭`
      log(id, '执行联合复验', '联合验收组', `第${round}轮复验合格，已回写验收项${defect.itemId}为合格`)
    } else if (passed) {
      // 初测合格但证据不足：不能关闭，继续挡住签署
      defect.status = '待联合复验'
      syncItemFromDefect(defect, '待复验', `第${round}轮复验初测合格但证据不足：${result}`)
      message = '复验初测合格但证据不足，缺陷保持待复验并继续阻断签署'
      log(id, '执行联合复验', '联合验收组', `第${round}轮复验初测合格但证据不足，验收项${defect.itemId}维持待复验`)
    } else {
      // 复验未通过：退回整改，验收项回写为不合格
      defect.status = '整改中'
      syncItemFromDefect(defect, '不合格', `第${round}轮复验未通过：${result}`)
      message = `第${round}轮复验未通过，结果已回写验收项为不合格，退回整改`
      log(id, '执行联合复验', '联合验收组', `第${round}轮复验未通过，已回写验收项${defect.itemId}为不合格`)
    }
    persist()
    return { ok: passed && evidenceSufficient, blocked: passed && !evidenceSufficient, message }
  }

  function decideDefect(
    id: string,
    status: '已关闭' | '带条件通过' | '整改中',
    note: string,
    reviewDate?: string
  ): ActionResult {
    if (frozen.value) return { ok: false, message: FROZEN_MESSAGE }
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }

    if (status === '已关闭') {
      if (!defect.retests.some((item) => item.passed && item.evidenceSufficient)) {
        return { ok: false, message: '没有“合格且证据充分”的复验记录，不能关闭' }
      }
      defect.status = '已关闭'
      defect.decisionNote = note || '复验合格，完成整改闭环'
      defect.reviewDate = undefined
      syncItemFromDefect(defect, '合格', `验收决定关闭：${defect.decisionNote}`)
    } else if (status === '带条件通过') {
      if (!note.trim()) return { ok: false, message: '带条件接受必须填写限制条件' }
      if (!reviewDate) return { ok: false, message: '带条件接受必须设定复查日期' }
      // 限制条件与复查日期随缺陷保留，到期复查前仍可被签署校验拦截
      defect.status = '带条件通过'
      defect.decisionNote = note.trim()
      defect.reviewDate = reviewDate
      syncItemFromDefect(defect, '合格', `带条件接受（复查至${reviewDate}）：${note.trim()}`)
    } else {
      defect.status = '整改中'
      defect.decisionNote = note
      defect.reviewDate = undefined
      syncItemFromDefect(defect, '不合格', note ? `验收退回整改：${note}` : '验收退回整改')
    }
    defect.version += 1
    log(id, `验收决定：${status}`, '验收负责人',
      status === '带条件通过' ? `限制条件：${note}；复查日期：${reviewDate}` : note || '完成整改闭环')
    persist()
    return { ok: true, message: `缺陷已更新为${status}` }
  }

  function signOff(): ActionResult {
    if (frozen.value) return { ok: false, message: FROZEN_MESSAGE }
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }
    // 更正申请时已为新工作区分配版本号；首次签署时在此递增
    const fromCorrection = !!correction.value
    if (!fromCorrection) plant.value.version += 1
    plant.value.status = '已签署'
    equipment.value.forEach((node) => { node.status = '已验收' })

    // 冻结当前工作区为交付版本快照：设备、证书、缺陷、审计逐项对应
    const pack: DeliveryPackage = {
      version: plant.value.version,
      signedAt: new Date().toISOString(),
      signer: '验收负责人陆川',
      plant: snapshot(plant.value),
      equipment: snapshot(equipment.value),
      defects: snapshot(defects.value),
      audit: snapshot(audit.value),
      superseded: false,
      correctionOf: correction.value?.fromVersion,
      correctionReason: correction.value?.reason
    }
    deliveries.value.push(pack)
    log(plant.value.id, '签署交付版本', '验收负责人陆川',
      correction.value
        ? `基于更正申请（源自V${correction.value.fromVersion}）锁定V${plant.value.version}并生成交付包`
        : `锁定V${plant.value.version}并生成交付包`)
    // 签署日志也要写入本次快照，保证页面与审计记录对应
    pack.audit = snapshot(audit.value)
    correction.value = null
    persist()
    return { ok: true, message: `签署完成，交付版本V${plant.value.version}已冻结` }
  }

  /** 签署后确需更正：写明原因，工作区解冻并另存为新版本，旧交付版本仍可查看 */
  function requestCorrection(reason: string, operator = '验收负责人陆川'): ActionResult {
    const trimmed = reason.trim()
    if (!trimmed) return { ok: false, message: '更正必须写明原因' }
    if (!frozen.value) return { ok: false, message: '当前版本尚未签署，无需更正' }

    const fromVersion = plant.value.version
    deliveries.value.forEach((item) => { item.superseded = true })
    correction.value = { reason: trimmed, fromVersion, operator, requestedAt: new Date().toISOString() }

    plant.value.status = '验收中'
    plant.value.version += 1
    equipment.value.forEach((node) => { node.status = '验收中' })

    log(plant.value.id, '申请签署后更正', operator,
      `交付版本V${fromVersion}冻结数据保留可查；更正原因：${trimmed}；工作区另存为V${plant.value.version}`)
    persist()
    return { ok: true, message: `已基于V${fromVersion}开启更正工作区V${plant.value.version}，旧交付版本仍可查看` }
  }

  function getDelivery(version: number) {
    return deliveries.value.find((item) => item.version === version) ?? null
  }

  function reset() {
    plant.value = structuredClone(seedPlant)
    equipment.value = structuredClone(seedEquipment)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    deliveries.value = []
    correction.value = null
    persist()
  }

  return {
    plant, equipment, defects, audit, deliveries, correction,
    selectedEquipmentId, keyword, hydrated, frozen, currentDelivery,
    selectedEquipment, stats, preflight,
    hydrate, persist, updateItem, verifyCertificate, assignDefect, addReply,
    addRetest, decideDefect, signOff, requestCorrection, getDelivery, reset
  }
})
