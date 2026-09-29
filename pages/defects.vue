<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'
import type { AcceptanceDefect, PartyReply, RetestConclusion } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const selected = ref<AcceptanceDefect | null>(null)
const replyVisible = ref(false)
const retestVisible = ref(false)
const reply = reactive<PartyReply>({ party: '设备厂家', owner: '', content: '', evidence: '', repliedAt: new Date().toISOString() })
const retest = reactive<{ result: string; conclusion: RetestConclusion; note: string; reviewDate: string }>({ result: '', conclusion: '通过', note: '', reviewDate: new Date().toISOString().slice(0, 10) })
const rows = computed(() => store.defects.filter((item) => !store.keyword || `${item.id} ${item.title} ${item.owner} ${item.status}`.includes(store.keyword)))
const linkedItem = computed(() => {
  if (!selected.value) return undefined
  return store.findItem(selected.value.equipmentId, selected.value.itemId).item
})
watch(retestVisible, (open) => {
  if (open) retest.reviewDate = new Date().toISOString().slice(0, 10)
})
function open(defect: AcceptanceDefect) { selected.value = defect }
function submitReply() {
  if (!selected.value) return
  const result = store.addReply(selected.value.id, { ...reply, repliedAt: new Date().toISOString() })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 2800 })
  if (result.ok) replyVisible.value = false
}
function submitRetest() {
  if (!selected.value) return
  const result = store.addRetest(selected.value.id, retest.result, retest.conclusion)
  const conclusion: RetestConclusion | undefined = 'conclusion' in result ? result.conclusion : undefined
  toast.add({ severity: result.ok ? 'success' : conclusion === '证据不足' ? 'warn' : 'error', summary: result.message, life: 3200 })
  retestVisible.value = false
}
function decide(status: '已关闭' | '带条件通过' | '整改中') {
  if (!selected.value) return
  const result = store.decideDefect(selected.value.id, status, retest.note, status === '带条件通过' ? retest.reviewDate : undefined)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
}
const conclusionSeverity = (value: RetestConclusion) => value === '通过' ? 'success' : value === '证据不足' ? 'warn' : 'danger'
</script>

<template>
  <section class="page">
    <div class="section-head"><div><h2>缺陷闭环处置</h2><p>建设、设备厂家与运维单位分别提交说明，复验结论将自动回写对应验收项；验收负责人决定通过、退回或带条件接受。</p></div><InputText v-model="store.keyword" placeholder="搜索缺陷、责任方或状态" /></div>
    <div v-if="store.frozen" class="freeze-banner"><i class="pi pi-lock" />交付版本 V{{ store.plant.version }} 已签署冻结，设备、证书与缺陷不可更改；确需更正请到「签署与审计」发起更正并另存新版本。</div>
    <DataTable :value="rows" dataKey="id" size="small" selectionMode="single" @rowSelect="(event: any) => open(event.data)">
      <Column field="id" header="编号" />
      <Column field="title" header="缺陷" />
      <Column field="equipmentId" header="设备" />
      <Column field="severity" header="严重度"><template #body="{ data }"><Tag :value="data.severity" :severity="data.severity === '重大' ? 'danger' : 'warn'" /></template></Column>
      <Column field="owner" header="责任方" />
      <Column field="dueDate" header="截止" />
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '已关闭' ? 'success' : data.status === '带条件通过' ? 'info' : 'warn'" /></template></Column>
      <Column header="复查日期"><template #body="{ data }">{{ data.status === '带条件通过' ? (data.reviewDate || '未登记') : '—' }}</template></Column>
      <Column header="版本"><template #body="{ data }">V{{ data.version }}</template></Column>
    </DataTable>
    <div v-if="selected" class="detail-panel">
      <div class="detail-title">
        <div><span>{{ selected.id }} · {{ selected.equipmentId }} · 关联验收项 {{ selected.itemId }}</span><h3>{{ selected.title }}</h3></div>
        <div><Button label="多方回复" outlined :disabled="store.frozen" @click="replyVisible = true" /><Button label="联合复验" :disabled="store.frozen" @click="retestVisible = true" /></div>
      </div>
      <div v-if="linkedItem" class="sync-band">
        <Tag :value="`验收项已回写：${linkedItem.status}`" :severity="linkedItem.status === '合格' ? 'success' : 'danger'" />
        <template v-if="linkedItem.conditionalNote">
          <span>带条件限制：{{ linkedItem.conditionalNote }}</span>
          <span>复查日期：{{ linkedItem.reviewDate }}</span>
        </template>
        <span v-else-if="linkedItem.sourceDefectId === selected.id">最近回写缺陷：{{ linkedItem.sourceDefectId }} · 验收项V{{ linkedItem.version }}</span>
      </div>
      <div v-if="selected.status === '带条件通过'" class="conditional-band">
        <Tag value="带条件接受" severity="info" />
        <span>限制条件：{{ selected.decisionNote }}</span>
        <span>复查日期：{{ selected.reviewDate }}</span>
      </div>
      <h4>复验轮次</h4>
      <DataTable :value="selected.retests" dataKey="round" size="small">
        <Column field="round" header="轮次" style="width:60px" />
        <Column header="结论"><template #body="{ data }"><Tag :value="data.conclusion" :severity="conclusionSeverity(data.conclusion)" /></template></Column>
        <Column field="result" header="复验结果" />
        <Column field="tester" header="复验人" />
        <Column header="时间"><template #body="{ data }">{{ data.testedAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      </DataTable>
      <div class="reply-list"><article v-for="item in selected.replies" :key="item.repliedAt"><Tag :value="item.party" /><strong>{{ item.owner }}</strong><p>{{ item.content }}</p><span>{{ item.evidence }} · {{ item.repliedAt.replace('T', ' ').slice(0, 16) }}</span></article></div>
      <div class="decision-band">
        <Textarea v-model="retest.note" rows="2" placeholder="验收决定说明；带条件接受时必须填写限制条件" :disabled="store.frozen" />
        <label class="review-date">复查日期<input v-model="retest.reviewDate" type="date" :disabled="store.frozen" /></label>
        <Button label="通过并关闭" :disabled="store.frozen" @click="decide('已关闭')" />
        <Button label="带条件接受" severity="secondary" outlined :disabled="store.frozen" @click="decide('带条件通过')" />
        <Button label="退回整改" severity="danger" outlined :disabled="store.frozen" @click="decide('整改中')" />
      </div>
    </div>
    <Dialog v-model:visible="replyVisible" header="提交多方处理说明" modal :style="{ width: '580px' }">
      <div class="edit-grid">
        <label>责任方<Select v-model="reply.party" :options="['建设单位', '设备厂家', '运维单位']" /></label>
        <label>回复人<InputText v-model="reply.owner" /></label>
        <label>处理说明<Textarea v-model="reply.content" rows="4" /></label>
        <label>证据附件<InputText v-model="reply.evidence" placeholder="整改记录或报告名称（必填，证据不足复验将被挡住）" /></label>
      </div>
      <template #footer><Button label="取消" text severity="secondary" @click="replyVisible = false" /><Button label="提交并进入复验" @click="submitReply" /></template>
    </Dialog>
    <Dialog v-model:visible="retestVisible" header="登记联合复验（结论将回写关联验收项）" modal :style="{ width: '560px' }">
      <div class="edit-grid">
        <label>复验结果<Textarea v-model="retest.result" rows="4" placeholder="通过或未通过均需写明实测数据；证据不足写明缺失材料" /></label>
        <label>结论
          <Select v-model="retest.conclusion" :options="['通过', '未通过', '证据不足']" />
          <small class="retest-hint">通过：缺陷关闭、验收项合格；未通过：退回整改、验收项不合格；证据不足：保持待复验，继续挡住签署。</small>
        </label>
      </div>
      <template #footer><Button label="取消" text severity="secondary" @click="retestVisible = false" /><Button label="提交复验轮次" @click="submitRetest" /></template>
    </Dialog>
  </section>
</template>
