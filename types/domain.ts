export type InspectionStatus = '待检查' | '合格' | '不合格' | '待复验'
export type DefectStatus = '待分派' | '整改中' | '待联合复验' | '已关闭' | '带条件通过'
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
  /** 缺陷复验/验收决定回写说明，人工重新录入后会清空 */
  syncNote?: string
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

export interface DefectRetest {
  round: number
  passed: boolean
  result: string
  evidence: string
  /** 复验证据是否充分；不充分时即使初测合格也不能关闭缺陷 */
  evidenceSufficient: boolean
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
  retests: DefectRetest[]
  decisionNote: string
  /** 带条件接受时的复查日期 */
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
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 该操作发生时所属的交付工作版本 */
  plantVersion?: number
}

/** 签署时冻结的交付版本快照 */
export interface DeliveryPackage {
  version: number
  signedAt: string
  signer: string
  plant: Plant
  equipment: EquipmentNode[]
  defects: AcceptanceDefect[]
  audit: AuditEntry[]
  /** 是否已经被更新的交付版本替代 */
  superseded: boolean
  /** 若为签署后更正再签署，记录来源版本与原因 */
  correctionOf?: number
  correctionReason?: string
}
