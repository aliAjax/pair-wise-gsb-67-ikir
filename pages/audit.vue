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
import type { DeliveryPackage } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const keyword = ref('')
const correctVisible = ref(false)
const correctionReason = ref('')
const viewing = ref<DeliveryPackage | null>(null)
const rows = computed(() => store.audit.filter((item) => !keyword.value || `${item.entityId} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value)))
const archive = computed(() => [...store.deliveries].sort((a, b) => b.version - a.version))

const sign = () => {
  const result = store.signOff()
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.ok ? '签署完成' : '完整性校验未通过', detail: result.message, life: 4200 })
}
const submitCorrection = () => {
  const result = store.requestCorrection(correctionReason.value)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3600 })
  if (result.ok) {
    correctVisible.value = false
    correctionReason.value = ''
  }
}
const openDelivery = (version: number) => {
  const pkg = store.getDelivery(version)
  if (pkg) viewing.value = pkg
}
const exportPackage = () => {
  const payload = {
    plant: store.plant,
    equipment: store.equipment,
    defects: store.defects,
    audit: store.audit,
    deliveries: store.deliveries,
    correction: store.correction,
    preflight: store.preflight
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `光伏并网验收交付包-V${store.plant.version}.json`; anchor.click(); URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="page">
    <div class="preflight-panel" :class="{ frozen: store.frozen }">
      <div>
        <span>并网前完整性校验</span>
        <strong>{{ store.frozen ? `交付版本V${store.plant.version}已冻结` : store.preflight.allowed ? '全部条件满足，可签署锁定' : `${store.preflight.blocking.length}项阻断` }}</strong>
        <p v-for="item in store.preflight.blocking" :key="item">{{ item }}</p>
        <p v-if="store.correction" class="correction-note">更正工作区V{{ store.plant.version }}：源自V{{ store.correction.fromVersion }}，原因：{{ store.correction.reason }}</p>
      </div>
      <div class="preflight-actions">
        <Button label="导出交付包" outlined @click="exportPackage" />
        <Button v-if="!store.frozen" label="签署并锁定版本" :disabled="!store.preflight.allowed" @click="sign" />
        <Button v-else label="申请签署后更正" severity="warning" outlined @click="correctVisible = true" />
      </div>
    </div>

    <div class="section-head"><div><h2>交付版本档案</h2><p>签署即冻结设备、证书与缺陷；旧交付版本永久保留可查，更正后另存新版本。</p></div></div>
    <div class="delivery-archive">
      <article v-for="pkg in archive" :key="pkg.version">
        <Tag value="当前交付" severity="success" v-if="!pkg.superseded" />
        <Tag value="已被替代" severity="secondary" v-else />
        <strong>V{{ pkg.version }}</strong>
        <span>{{ pkg.signedAt.replace('T', ' ').slice(0, 16) }} · {{ pkg.signer }}</span>
        <small v-if="pkg.correctionOf">更正自 V{{ pkg.correctionOf }}：{{ pkg.correctionReason }}</small>
        <Button label="查看冻结内容" text size="small" @click="openDelivery(pkg.version)" />
      </article>
      <p v-if="!archive.length" class="muted">尚未签署过交付版本。</p>
    </div>

    <div class="section-head" style="margin-top:18px"><div><h2>验收审计</h2><p>当前工作版本 V{{ store.plant.version }} · {{ store.plant.status }}</p></div><InputText v-model="keyword" placeholder="搜索实体、动作或操作人" /></div>
    <DataTable :value="rows" dataKey="id" size="small">
      <Column field="createdAt" header="时间"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column header="版本" style="width:72px"><template #body="{ data }">{{ data.plantVersion ? `V${data.plantVersion}` : '—' }}</template></Column>
      <Column field="entityId" header="实体" />
      <Column field="action" header="动作"><template #body="{ data }"><Tag :value="data.action" /></template></Column>
      <Column field="operator" header="操作人" />
      <Column field="detail" header="说明" />
    </DataTable>

    <Dialog v-model:visible="correctVisible" header="申请签署后更正" modal :style="{ width: '520px' }">
      <p class="form-hint">交付版本 V{{ store.plant.version }} 将保留在版本档案中继续可查；工作区解冻并另存为 V{{ store.plant.version + 1 }}，重新签署后才会生成新的冻结交付版本。</p>
      <label class="reason-label">更正原因（必填）<Textarea v-model="correctionReason" rows="4" placeholder="写明需更正的设备/证书/缺陷及原因，例如：并网点保护定值单换发后需重新核对" /></label>
      <template #footer><Button label="取消" text severity="secondary" @click="correctVisible = false" /><Button label="确认并另存新版本" severity="warning" @click="submitCorrection" /></template>
    </Dialog>

    <Dialog :visible="!!viewing" @update:visible="(v: boolean) => { if (!v) viewing = null }" :header="`交付版本 V${viewing?.version ?? ''} 冻结内容（只读）`" modal :style="{ width: '860px' }">
      <div v-if="viewing" class="delivery-view">
        <p class="muted">签署时间 {{ viewing.signedAt.replace('T', ' ').slice(0, 16) }} · {{ viewing.signer }} · {{ viewing.superseded ? '该版本已被新版本替代' : '当前有效交付版本' }}<template v-if="viewing.correctionOf"> · 更正自V{{ viewing.correctionOf }}：{{ viewing.correctionReason }}</template></p>
        <h4>设备与验收项</h4>
        <div v-for="node in viewing.equipment" :key="node.id" class="view-block">
          <strong>{{ node.name }}（{{ node.code }}） · {{ node.status }}</strong>
          <ul>
            <li v-for="item in node.items" :key="item.id">{{ item.id }} {{ item.standard }} — <Tag :value="item.status" :severity="item.status === '合格' ? 'success' : item.status === '不合格' ? 'danger' : 'warn'" /> V{{ item.version }}<span v-if="item.syncNote"> · {{ item.syncNote }}</span></li>
          </ul>
          <ul>
            <li v-for="cert in node.certificates" :key="cert.id">{{ cert.name }}（{{ cert.issuer }}，有效期至{{ cert.expiresAt }}） — <Tag :value="cert.verified ? '已核验' : '待核验'" :severity="cert.verified ? 'success' : 'danger'" /> V{{ cert.version }}</li>
          </ul>
        </div>
        <h4>缺陷闭环</h4>
        <div v-for="defect in viewing.defects" :key="defect.id" class="view-block">
          <strong>{{ defect.id }} {{ defect.title }} — <Tag :value="defect.status" :severity="defect.status === '已关闭' ? 'success' : defect.status === '带条件通过' ? 'info' : 'warn'" /> V{{ defect.version }}</strong>
          <p v-if="defect.decisionNote" class="muted">决定说明：{{ defect.decisionNote }}<template v-if="defect.reviewDate"> · 复查日期 {{ defect.reviewDate }}</template></p>
        </div>
        <h4>该版本审计记录（{{ viewing.audit.length }}条）</h4>
        <div class="view-audit">
          <p v-for="entry in [...viewing.audit].slice(0, 30)" :key="entry.id"><small>{{ entry.createdAt.replace('T', ' ').slice(0, 16) }} {{ entry.plantVersion ? `V${entry.plantVersion}` : '' }}</small> {{ entry.entityId }} · {{ entry.action }} · {{ entry.operator }} — {{ entry.detail }}</p>
        </div>
      </div>
    </Dialog>
  </section>
</template>
