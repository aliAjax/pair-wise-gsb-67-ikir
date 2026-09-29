import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedEquipment, seedPlant } from '../data/seed'
import type { AcceptanceDefect, AcceptanceItem, AuditEntry, DeliveryVersion, EquipmentNode, PartyReply, Plant, RetestConclusion } from '../types/domain'

const STORAGE_KEY = 'gsb67:grid-acceptance'
let idSeed = 30

export const useAcceptanceStore = defineStore('acceptance', () => {
  const plant = ref<Plant>(structuredClone(seedPlant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seedEquipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seedDefects))
  const audit = ref<AuditEntry[]>(structuredClone(seedAudit))
  const deliveries = ref<DeliveryVersion[]>([])
  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)

  /** 签署完成后设备、证书、缺陷及验收项全部冻结，只有「更正办理」可解冻 */
  const frozen = computed(() => plant.value.status === '已签署')

  const selectedEquipment = computed(() => equipment.value.find((item) => item.id === selectedEquipmentId.value))

  function findItem(equipmentId: string, itemId: string) {
    const node = equipment.value.find((value) => value.id === equipmentId)
    const item = node?.items.find((value) => value.id === itemId)
    return { node, item }
  }

  function linkedDefect(itemId: string) {
    return defects.value.find((defect) => defect.itemId === itemId && defect.status !== '待分派')
  }

  const stats = computed(() => {
    const items = equipment.value.flatMap((item) => item.items)
    return {
      total: items.length,
      passed: items.filter((item) => item.status === '合格').length,
      failed: items.filter((item) => item.status === '不合格' || item.status === '待复验').length,
      openDefects: defects.value.filter((item) => !['已关闭', '带条件通过'].includes(item.status)).length,
      conditional: defects.value.filter((item) => item.status === '带条件通过').length
    }
  })

  const preflight = computed(() => {
    const blocking: string[] = []
    const warnings: string[] = []
    const items = equipment.value.flatMap((item) => item.items)
    if (items.some((item) => item.status === '待检查')) blocking.push('仍有验收项未检查')
    if (items.some((item) => item.status === '不合格' || item.status === '待复验')) blocking.push('存在不合格或待复验项（复验未通过或证据不足需继续整改）')
    if (defects.value.some((item) => !['已关闭', '带条件通过'].includes(item.status))) blocking.push('存在未闭环缺陷')
    const certificates = equipment.value.flatMap((item) => item.certificates)
    if (certificates.some((item) => !item.verified)) blocking.push('存在未核验证书')
    if (certificates.some((item) => item.expiresAt < plant.value.commissioningDate)) blocking.push('证书在并网日期前失效')
    const conditional = defects.value.filter((item) => item.status === '带条件通过')
    for (const defect of conditional) {
      warnings.push(`缺陷${defect.id}带条件接受：${defect.decisionNote || '限制条件未登记'}，复查日期${defect.reviewDate || '未登记'}`)
    }
    return { allowed: blocking.length === 0, blocking, warnings }
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
        deliveries.value = stored.deliveries ?? []
        // 旧版数据迁移：补齐复验结论与已签署版本的交付快照
        for (const defect of defects.value) {
          for (const retest of defect.retests) {
            if (!retest.conclusion) retest.conclusion = retest.passed ? '通过' : '未通过'
          }
        }
        if (plant.value.status === '已签署' && deliveries.value.length === 0) {
          deliveries.value = [buildSnapshot(plant.value.version, plant.value.signedAt ?? new Date().toISOString(), '陆川', '已签署数据迁移补录')]
        }
      }
    } catch {
      // Seed data is kept when browser storage is corrupt.
    }
    hydrated.value = true
  }

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ plant: plant.value, equipment: equipment.value, defects: defects.value, audit: audit.value, deliveries: deliveries.value }))
  }

  function log(entityId: string, action: string, operator: string, detail: string) {
    audit.value.unshift({ id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: new Date().toISOString(), version: plant.value.version })
  }

  function freezeGuard(): { ok: boolean; message?: string } {
    if (frozen.value) return { ok: false, message: `交付版本V${plant.value.version}已签署冻结，请先发起「签署后更正」另存新版本` }
    return { ok: true }
  }

  /**
   * 将缺陷的最终处置回写对应验收项：
   * - 复验通过/关闭 → 合格，签署放行
   * - 带条件通过 → 合格但保留限制条件与复查日期
   * - 复验未通过/证据不足/退回整改 → 待复验或不合格，继续挡住签署
   */
  function syncItemFromDefect(defect: AcceptanceDefect) {
    const { node, item } = findItem(defect.equipmentId, defect.itemId)
    if (!node || !item) return
    const previous = item.status
    item.version += 1
    item.sourceDefectId = defect.id
    if (defect.status === '已关闭') {
      item.status = '合格'
      item.conditionalNote = ''
      item.reviewDate = ''
    } else if (defect.status === '带条件通过') {
      item.status = '合格'
      item.conditionalNote = defect.decisionNote
      item.reviewDate = defect.reviewDate
    } else if (defect.status === '整改中') {
      item.status = '不合格'
    } else {
      item.status = '待复验'
    }
    if (previous !== item.status) {
      log(item.id, '验收项状态随缺陷回写', '联合验收组', `缺陷${defect.id}处置为「${defect.status}」，验收项${item.id}：${previous} → ${item.status}`)
    }
  }

  function updateItem(equipmentId: string, itemId: string, patch: Partial<AcceptanceItem>, operator = '当前用户') {
    const guard = freezeGuard()
    if (!guard.ok) return guard
    const { item } = findItem(equipmentId, itemId)
    if (!item) return { ok: false, message: '验收项不存在' }
    // 仅人工录入字段可改；来源缺陷与带条件信息由缺陷处置回写维护
    const { status, measured, evidence, condition } = patch
    Object.assign(item, { status, measured, evidence, condition }, { version: item.version + 1 })
    log(equipmentId, '更新验收项', operator, `${item.id}状态更新为${item.status}`)
    persist()
    return { ok: true, message: `验收项${item.id}已更新为${item.status}` }
  }

  function assignDefect(id: string, owner: string) {
    const guard = freezeGuard()
    if (!guard.ok) return guard
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    defect.owner = owner
    defect.status = '整改中'
    defect.version += 1
    syncItemFromDefect(defect)
    log(id, '分派缺陷', '验收负责人', `责任方调整为${owner}`)
    persist()
    return { ok: true, message: `已分派给${owner}，关联验收项同步为待整改` }
  }

  function addReply(id: string, reply: PartyReply) {
    const guard = freezeGuard()
    if (!guard.ok) return guard
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!reply.content || !reply.evidence) return { ok: false, message: '回复内容和证据均不能为空，证据不足将无法通过复验' }
    defect.replies.unshift(reply)
    defect.status = '待联合复验'
    defect.version += 1
    syncItemFromDefect(defect)
    log(id, `${reply.party}提交处理说明`, reply.owner, `${reply.content}（证据：${reply.evidence}）`)
    persist()
    return { ok: true, message: '已提交处理说明并进入联合复验' }
  }

  /**
   * 登记联合复验轮次并回写验收项：
   * 通过 → 缺陷关闭、验收项合格；未通过 → 退回整改、验收项不合格；
   * 证据不足 → 保持待联合复验、验收项待复验，签署继续被阻断。
   */
  function addRetest(id: string, result: string, conclusion: RetestConclusion, tester = '联合验收组') {
    const guard = freezeGuard()
    if (!guard.ok) return guard
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!result.trim()) return { ok: false, message: '复验结果说明不能为空' }
    const passed = conclusion === '通过'
    defect.retests.unshift({ round: defect.retests.length + 1, passed, conclusion, result, tester, testedAt: new Date().toISOString() })
    if (passed) {
      defect.status = '已关闭'
      defect.decisionNote = ''
      defect.reviewDate = ''
    } else if (conclusion === '证据不足') {
      defect.status = '待联合复验'
    } else {
      defect.status = '整改中'
    }
    defect.version += 1
    syncItemFromDefect(defect)
    const summary = passed ? '复验通过，缺陷已关闭，验收项回写为合格' : conclusion === '证据不足' ? '证据不足，需补充证据后重新复验，签署继续阻断' : '复验未通过，退回整改，关联验收项同步为不合格'
    log(id, `执行联合复验（第${defect.retests[0].round}轮·${conclusion}）`, tester, result)
    persist()
    return { ok: passed, conclusion, message: summary }
  }

  /** 验收决定：通过并关闭 / 带条件接受（必须写明限制条件与复查日期）/ 退回整改 */
  function decideDefect(id: string, status: '已关闭' | '带条件通过' | '整改中', note: string, reviewDate?: string) {
    const guard = freezeGuard()
    if (!guard.ok) return guard
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (status === '已关闭' && !defect.retests.some((item) => item.passed)) return { ok: false, message: '没有合格复验记录，不能关闭' }
    if (status === '带条件通过') {
      if (!note.trim()) return { ok: false, message: '带条件接受必须写明限制条件' }
      if (!reviewDate) return { ok: false, message: '带条件接受必须填写复查日期' }
    }
    defect.status = status
    defect.decisionNote = status === '带条件通过' ? note.trim() : note
    defect.reviewDate = status === '带条件通过' ? reviewDate : ''
    defect.version += 1
    syncItemFromDefect(defect)
    log(id, `验收决定：${status}`, '验收负责人陆川', status === '带条件通过' ? `限制条件：${note}；复查日期：${reviewDate}` : note || '完成整改闭环')
    persist()
    return { ok: true, message: `缺陷已更新为${status}${status === '带条件通过' ? '，限制条件与复查日期已保留' : ''}` }
  }

  function verifyCertificate(equipmentId: string, certificateId: string) {
    const guard = freezeGuard()
    if (!guard.ok) return guard
    const certificate = equipment.value.find((node) => node.id === equipmentId)?.certificates.find((value) => value.id === certificateId)
    if (!certificate) return { ok: false, message: '证书不存在' }
    certificate.verified = true
    certificate.version += 1
    log(equipmentId, '核验证书', '验收负责人陆川', `${certificate.name}（${certificate.issuer}）已核验，版本V${certificate.version}`)
    persist()
    return { ok: true, message: `证书${certificate.name}已核验` }
  }

  function buildSnapshot(version: number, signedAt: string, signedBy: string, note: string, correctionOfVersion?: number, correctionReason?: string): DeliveryVersion {
    // 经 JSON 取原始值，避免把 Vue reactive 代理（不可结构化克隆）写入交付快照
    return {
      version,
      signedAt,
      signedBy,
      note,
      correctionOfVersion,
      correctionReason,
      snapshot: {
        plant: JSON.parse(JSON.stringify(plant.value)),
        equipment: JSON.parse(JSON.stringify(equipment.value)),
        defects: JSON.parse(JSON.stringify(defects.value)),
        audit: JSON.parse(JSON.stringify(audit.value)),
        preflight: { blocking: [...preflight.value.blocking], warnings: [...preflight.value.warnings] }
      }
    }
  }

  /** 签署并锁定：通过完整性校验后冻结全部数据并留存交付快照 */
  function signOff() {
    const guard = freezeGuard()
    if (!guard.ok) return guard
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }
    const signedVersion = plant.value.version
    plant.value.status = '已签署'
    plant.value.signedAt = new Date().toISOString()
    const correctionOfVersion = plant.value.correctionBaseVersion
    const correctionReason = plant.value.correctionReason
    plant.value.correctionReason = ''
    plant.value.correctionBaseVersion = undefined
    equipment.value.forEach((node) => { node.status = '已验收' })
    const delivery = buildSnapshot(signedVersion, plant.value.signedAt, '验收负责人陆川', preflight.value.warnings.length ? `带条件接受${preflight.value.warnings.length}项` : '完整性校验全部通过', correctionOfVersion, correctionReason)
    deliveries.value.push(delivery)
    log(plant.value.id, '签署交付版本', '验收负责人陆川', `锁定V${signedVersion}并生成交付包${preflight.value.warnings.length ? `，带条件接受${preflight.value.warnings.length}项（保留限制与复查日期）` : ''}${correctionOfVersion ? `；该版本为签署后更正版本，基于V${correctionOfVersion}，原因：${correctionReason}` : ''}`)
    persist()
    return { ok: true, message: `签署完成，交付版本V${signedVersion}已冻结` }
  }

  /**
   * 签署后更正：写明原因，冻结的旧交付版本保留可查，
   * 工作副本递增为新版本并解冻，重新办理后再次签署即生成新一版交付包。
   */
  function requestCorrection(reason: string) {
    if (!frozen.value) return { ok: false, message: '当前版本未签署，无需发起更正' }
    if (!reason.trim()) return { ok: false, message: '更正必须写明原因' }
    const baseVersion = plant.value.version
    plant.value.status = '验收中'
    plant.value.correctionReason = reason.trim()
    plant.value.correctionBaseVersion = baseVersion
    plant.value.version += 1
    equipment.value.forEach((node) => { node.status = '验收中' })
    log(plant.value.id, '发起签署后更正', '验收负责人陆川', `基于已交付版本V${baseVersion}另存V${plant.value.version}继续办理。更正原因：${reason.trim()}；旧交付版本V${baseVersion}冻结保留可查`)
    persist()
    return { ok: true, message: `已基于V${baseVersion}另存V${plant.value.version}，可更正后重新签署` }
  }

  function reset() {
    plant.value = structuredClone(seedPlant)
    equipment.value = structuredClone(seedEquipment)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    deliveries.value = []
    persist()
  }

  return {
    plant, equipment, defects, audit, deliveries, selectedEquipmentId, keyword, hydrated, frozen,
    selectedEquipment, stats, preflight, hydrate, findItem, linkedDefect,
    updateItem, assignDefect, addReply, addRetest, decideDefect, verifyCertificate,
    signOff, requestCorrection, reset
  }
})
