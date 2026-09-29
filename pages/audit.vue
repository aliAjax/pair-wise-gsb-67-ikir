<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'
import type { DeliveryVersion } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const keyword = ref('')
const correctionVisible = ref(false)
const correctionReason = ref('')
const viewing = ref<DeliveryVersion | null>(null)
const viewerVisible = computed({
  get: () => !!viewing.value,
  set: (value) => { if (!value) viewing.value = null }
})
const rows = computed(() => store.audit.filter((item) => !keyword.value || `${item.entityId} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value)))

function sign() {
  const result = store.signOff()
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.ok ? '签署完成' : '完整性校验未通过', detail: result.message, life: 4500 })
}
function submitCorrection() {
  const result = store.requestCorrection(correctionReason.value)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 4000 })
  if (result.ok) {
    correctionVisible.value = false
    correctionReason.value = ''
  }
}
function exportPackage() {
  const payload = { plant: store.plant, equipment: store.equipment, defects: store.defects, audit: store.audit, deliveries: store.deliveries, preflight: store.preflight }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `光伏并网验收交付包-V${store.plant.version}.json`; anchor.click(); URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="page">
    <div class="preflight-panel" :class="{ signed: store.frozen }">
      <div>
        <span>并网前完整性校验 · 当前工作版本 V{{ store.plant.version }}</span>
        <strong>{{ store.frozen ? `交付版本V${store.plant.version}已签署冻结` : store.preflight.allowed ? '全部条件满足，可以签署' : `${store.preflight.blocking.length}项阻断` }}</strong>
        <p v-for="item in store.preflight.blocking" :key="item">{{ item }}</p>
        <p v-for="item in store.preflight.warnings" :key="item" class="warning-line"><i class="pi pi-info-circle" />{{ item }}（带条件接受不阻断签署，到期须复查）</p>
        <p v-if="store.frozen" class="warning-line">签署时间：{{ store.plant.signedAt?.replace('T', ' ').slice(0, 16) }} · 设备、证书与缺陷均已冻结</p>
        <p v-if="store.plant.correctionReason" class="warning-line">更正办理中：基于V{{ store.plant.correctionBaseVersion }}另存V{{ store.plant.version }}，原因：{{ store.plant.correctionReason }}</p>
      </div>
      <div class="preflight-actions">
        <Button label="导出交付包" outlined @click="exportPackage" />
        <Button v-if="!store.frozen" label="签署并锁定版本" :disabled="!store.preflight.allowed" @click="sign" />
        <Button v-else label="签署后更正（另存新版本）" severity="warning" outlined @click="correctionVisible = true" />
      </div>
    </div>

    <div class="section-head"><div><h2>交付版本</h2><p>每次签署生成一份只读快照；签署后更正会另存新版本，旧交付版本仍可查看。</p></div></div>
    <DataTable :value="store.deliveries" dataKey="version" size="small" class="delivery-table">
      <Column header="版本"><template #body="{ data }">V{{ data.version }}<Tag v-if="data.version === store.plant.version && store.frozen" value="当前" severity="success" /></template></Column>
      <Column header="签署时间"><template #body="{ data }">{{ data.signedAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column field="signedBy" header="签署人" />
      <Column header="说明"><template #body="{ data }"><span>{{ data.note }}</span><div v-if="data.correctionReason" class="cell-note">更正自V{{ data.correctionOfVersion }}：{{ data.correctionReason }}</div></template></Column>
      <Column header="快照"><template #body="{ data }"><Button label="查看只读快照" text size="small" @click="viewing = data" /></template></Column>
    </DataTable>

    <div class="section-head" style="margin-top:20px"><div><h2>验收审计</h2><p>全部操作按工作版本留痕，可与交付快照内审计记录逐一对应。</p></div><InputText v-model="keyword" placeholder="搜索实体、动作或操作人" /></div>
    <DataTable :value="rows" dataKey="id" size="small">
      <Column header="时间"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column field="entityId" header="实体" />
      <Column field="action" header="动作"><template #body="{ data }"><Tag :value="data.action" /></template></Column>
      <Column field="operator" header="操作人" />
      <Column field="detail" header="说明" />
      <Column header="版本"><template #body="{ data }">V{{ data.version ?? '—' }}</template></Column>
    </DataTable>

    <Dialog v-model:visible="correctionVisible" header="签署后更正：另存新版本" modal :style="{ width: '560px' }">
      <p class="dialog-hint">已交付的 V{{ store.plant.version }} 将原样冻结保留；工作副本另存为 V{{ store.plant.version + 1 }} 并解冻，更正完成并重新签署后，V{{ store.plant.version + 1 }} 即成为新一版交付包。</p>
      <label class="full-label">更正原因（必填）<Textarea v-model="correctionReason" rows="4" placeholder="写明触发更正的原因，如：调度复核发现录波时标偏差需重新整定" /></label>
      <template #footer><Button label="取消" text severity="secondary" @click="correctionVisible = false" /><Button label="确认另存新版本" severity="warning" @click="submitCorrection" /></template>
    </Dialog>

    <Dialog v-model:visible="viewerVisible" :header="viewing ? `交付版本 V${viewing.version}（只读快照）` : ''" modal :style="{ width: '860px' }">
      <template v-if="viewing">
        <div class="snapshot-meta">
          <Tag value="已冻结交付版本" severity="success" />
          <span>签署：{{ viewing.signedAt.replace('T', ' ').slice(0, 16) }} · {{ viewing.signedBy }}</span>
          <span v-if="viewing.correctionReason">更正自V{{ viewing.correctionOfVersion }}：{{ viewing.correctionReason }}</span>
          <span v-else>{{ viewing.note }}</span>
        </div>
        <h4>设备与验收项（{{ viewing.snapshot.equipment.length }}个节点）</h4>
        <div v-for="node in viewing.snapshot.equipment" :key="node.id" class="snapshot-node">
          <strong>{{ node.name }}（{{ node.code }}）· {{ node.status }}</strong>
          <span v-for="item in node.items" :key="item.id" class="snapshot-item"><Tag :value="item.status" :severity="item.status === '合格' ? 'success' : item.status === '不合格' ? 'danger' : 'warn'" />{{ item.id }} {{ item.standard }} V{{ item.version }}<template v-if="item.conditionalNote">（限制：{{ item.conditionalNote }}，复查：{{ item.reviewDate }}）</template></span>
        </div>
        <h4>缺陷（{{ viewing.snapshot.defects.length }}项）</h4>
        <div v-for="defect in viewing.snapshot.defects" :key="defect.id" class="snapshot-node">
          <span class="snapshot-item"><Tag :value="defect.status" :severity="defect.status === '已关闭' ? 'success' : defect.status === '带条件通过' ? 'info' : 'warn'" />{{ defect.id }} {{ defect.title }} V{{ defect.version }}<template v-if="defect.status === '带条件通过'">（限制：{{ defect.decisionNote }}，复查：{{ defect.reviewDate }}）</template></span>
        </div>
        <h4>签署时校验结论</h4>
        <p v-if="!viewing.snapshot.preflight.blocking.length && !viewing.snapshot.preflight.warnings.length" class="dialog-hint">全部条件满足，无阻断与警告。</p>
        <p v-for="item in viewing.snapshot.preflight.warnings" :key="item" class="warning-line"><i class="pi pi-info-circle" />{{ item }}</p>
      </template>
      <template #footer><Button label="关闭" text severity="secondary" @click="viewing = null" /></template>
    </Dialog>
  </section>
</template>
