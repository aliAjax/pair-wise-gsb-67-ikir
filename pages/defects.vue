<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
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
import type { AcceptanceDefect, PartyReply } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const selected = ref<AcceptanceDefect | null>(null)
const replyVisible = ref(false)
const retestVisible = ref(false)
const reply = reactive<PartyReply>({ party: '设备厂家', owner: '', content: '', evidence: '', repliedAt: new Date().toISOString() })
const retest = reactive({ result: '', evidence: '', passed: true, evidenceSufficient: true, note: '', reviewDate: '' })
const rows = computed(() => store.defects.filter((item) => !store.keyword || `${item.id} ${item.title} ${item.owner} ${item.status}`.includes(store.keyword)))
function open(defect: AcceptanceDefect) {
  selected.value = defect
  retest.note = defect.status === '带条件通过' ? defect.decisionNote : ''
  retest.reviewDate = defect.reviewDate ?? ''
}
function submitReply() {
  if (!selected.value) return
  const result = store.addReply(selected.value.id, { ...reply, repliedAt: new Date().toISOString() })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 2500 })
  if (result.ok) replyVisible.value = false
}
function submitRetest() {
  if (!selected.value) return
  const result = store.addRetest(selected.value.id, retest.result, retest.passed, retest.evidence, retest.evidenceSufficient)
  toast.add({
    severity: result.ok ? 'success' : result.blocked ? 'warn' : retest.passed ? 'warn' : 'error',
    summary: result.message, life: 3200
  })
  retestVisible.value = false
}
function decide(status: '已关闭' | '带条件通过' | '整改中') {
  if (!selected.value) return
  const result = store.decideDefect(selected.value.id, status, retest.note, status === '带条件通过' ? retest.reviewDate : undefined)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
}
</script>

<template>
  <section class="page">
    <div class="section-head"><div><h2>缺陷闭环处置</h2><p>建设、设备厂家与运维单位分别提交说明，验收负责人决定通过、退回或带条件接受；复验结论自动回写对应验收项。</p></div><InputText v-model="store.keyword" placeholder="搜索缺陷、责任方或状态" /></div>
    <div v-if="store.frozen" class="freeze-banner"><i class="pi pi-lock" /><span>交付版本V{{ store.plant.version }}已签署冻结，缺陷处理流程只读；确需更正请到“签署与审计”页申请。</span></div>
    <DataTable :value="rows" dataKey="id" size="small" selectionMode="single" @rowSelect="(event: any) => open(event.data)">
      <Column field="id" header="编号" />
      <Column field="title" header="缺陷" />
      <Column field="equipmentId" header="设备" />
      <Column field="severity" header="严重度"><template #body="{ data }"><Tag :value="data.severity" :severity="data.severity === '重大' ? 'danger' : 'warn'" /></template></Column>
      <Column field="owner" header="责任方" />
      <Column field="dueDate" header="截止" />
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '已关闭' ? 'success' : data.status === '带条件通过' ? 'info' : 'warn'" /></template></Column>
      <Column header="复查日期"><template #body="{ data }">{{ data.reviewDate ?? '—' }}</template></Column>
      <Column header="版本"><template #body="{ data }">V{{ data.version }}</template></Column>
    </DataTable>
    <div v-if="selected" class="detail-panel">
      <div class="detail-title"><div><span>{{ selected.id }} · {{ selected.equipmentId }} / {{ selected.itemId }}</span><h3>{{ selected.title }}</h3></div><div><Button label="多方回复" outlined :disabled="store.frozen" @click="replyVisible = true" /><Button label="联合复验" :disabled="store.frozen" @click="retestVisible = true" /></div></div>
      <div v-if="selected.status === '带条件通过'" class="condition-band">
        <Tag value="带条件接受" severity="info" />
        <p><strong>限制条件：</strong>{{ selected.decisionNote }}</p>
        <p><strong>复查日期：</strong>{{ selected.reviewDate }}（到期未复查将继续阻断签署）</p>
      </div>
      <h4>复验轮次（结论同步回写验收项 {{ selected.itemId }}）</h4>
      <div class="retest-list">
        <article v-for="item in selected.retests" :key="item.round">
          <Tag :value="item.passed && item.evidenceSufficient ? '合格关闭' : item.passed ? '证据不足' : '复验未通过'" :severity="item.passed && item.evidenceSufficient ? 'success' : item.passed ? 'warn' : 'danger'" />
          <strong>第{{ item.round }}轮 · {{ item.testedAt.replace('T', ' ').slice(0, 16) }}</strong>
          <p>{{ item.result }}</p>
          <span>证据：{{ item.evidence }} · {{ item.evidenceSufficient ? '证据充分' : '证据不足，继续阻断签署' }} · {{ item.tester }}</span>
        </article>
        <p v-if="!selected.retests.length" class="muted">尚无复验记录。</p>
      </div>
      <div class="reply-list"><article v-for="item in selected.replies" :key="item.repliedAt"><Tag :value="item.party" /><strong>{{ item.owner }}</strong><p>{{ item.content }}</p><span>{{ item.evidence }} · {{ item.repliedAt.replace('T', ' ').slice(0, 16) }}</span></article></div>
      <div class="decision-band">
        <Textarea v-model="retest.note" rows="2" :disabled="store.frozen" placeholder="验收决定说明；带条件接受时必须填写限制条件" />
        <label class="review-input">复查日期<input v-model="retest.reviewDate" type="date" :disabled="store.frozen" /></label>
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
        <label>证据附件<InputText v-model="reply.evidence" placeholder="整改记录或报告名称" /></label>
      </div>
      <template #footer><Button label="取消" text severity="secondary" @click="replyVisible = false" /><Button label="提交并进入复验" @click="submitReply" /></template>
    </Dialog>
    <Dialog v-model:visible="retestVisible" header="登记联合复验" modal :style="{ width: '560px' }">
      <div class="edit-grid">
        <label>复验结果<Textarea v-model="retest.result" rows="4" placeholder="写明实测数据与标准比对情况" /></label>
        <label>复验证据附件<InputText v-model="retest.evidence" placeholder="复测记录、报告或曲线文件名" /></label>
        <label>复验结论<Select v-model="retest.passed" :options="[{ label: '初测合格', value: true }, { label: '复验未通过', value: false }]" /></label>
        <label>证据充分性<Select v-model="retest.evidenceSufficient" :options="[{ label: '证据充分（合格即可关闭并回写验收项）', value: true }, { label: '证据不足（保持待复验，继续阻断签署）', value: false }]" /></label>
      </div>
      <p class="form-hint">复验未通过或证据不足，验收项保持不合格/待复验并继续挡住签署；合格且证据充分时自动关闭缺陷并回写验收项为合格。</p>
      <template #footer><Button label="取消" text severity="secondary" @click="retestVisible = false" /><Button label="提交复验轮次" @click="submitRetest" /></template>
    </Dialog>
  </section>
</template>
