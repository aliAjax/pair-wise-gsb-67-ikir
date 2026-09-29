export type InspectionStatus = '待检查' | '合格' | '不合格' | '待复验'
export type DefectStatus = '待分派' | '整改中' | '待联合复验' | '已关闭' | '带条件通过'
export type RetestConclusion = '通过' | '未通过' | '证据不足'
export type Party = '建设单位' | '设备厂家' | '运维单位'

export interface AcceptanceItem {
  id: string
  standard: string
  method: string
  condition: string
  status: InspectionStatus
  measured: string
  evidence: string
  version: number
  /** 最近一次回写该验收项的缺陷编号 */
  sourceDefectId?: string
  /** 带条件接受时保留的限制条件 */
  conditionalNote?: string
  /** 带条件接受时保留的复查日期(YYYY-MM-DD) */
  reviewDate?: string
}

export interface Certificate {
  id: string
  name: string
  issuer: string
  expiresAt: string
  version: number
  verified: boolean
}

export interface EquipmentNode {
  id: string
  parentId: string | null
  name: string
  type: '并网点' | '变压器' | '方阵' | '逆变器' | '汇流箱'
  code: string
  status: '待验收' | '验收中' | '已验收'
  items: AcceptanceItem[]
  certificates: Certificate[]
}

export interface PartyReply {
  party: Party
  owner: string
  content: string
  evidence: string
  repliedAt: string
}

export interface RetestRecord {
  round: number
  passed: boolean
  conclusion: RetestConclusion
  result: string
  tester: string
  testedAt: string
}

export interface AcceptanceDefect {
  id: string
  equipmentId: string
  itemId: string
  title: string
  severity: '一般' | '重大'
  status: DefectStatus
  owner: string
  dueDate: string
  replies: PartyReply[]
  retests: RetestRecord[]
  decisionNote: string
  /** 带条件接受时的复查日期(YYYY-MM-DD) */
  reviewDate?: string
  version: number
}

export interface Plant {
  id: string
  name: string
  gridPoint: string
  capacity: string
  commissioningDate: string
  status: '验收中' | '待复核' | '已签署'
  version: number
  signedAt?: string
  /** 签署后更正的原因（仅在更正办理期间保留） */
  correctionReason?: string
  /** 本次更正所基于的已交付版本号 */
  correctionBaseVersion?: number
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 该操作对应的交付版本（工作版本）号 */
  version?: number
}

export interface DeliverySnapshot {
  plant: Plant
  equipment: EquipmentNode[]
  defects: AcceptanceDefect[]
  audit: AuditEntry[]
  preflight: { blocking: string[]; warnings: string[] }
}

export interface DeliveryVersion {
  version: number
  signedAt: string
  signedBy: string
  note: string
  /** 若为签署后更正重新锁定，记录所基于的旧交付版本号 */
  correctionOfVersion?: number
  correctionReason?: string
  snapshot: DeliverySnapshot
}
