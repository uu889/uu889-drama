<template>
  <div class="settings-page">
    <div class="settings-layout">
      <aside class="settings-nav">
        <div class="nav-group">
          <div class="nav-group-label">{{ t('settings.groupBase') }}</div>
          <button v-for="nt in baseTabs" :key="nt.id" :class="['nav-item', { active: tab === nt.id }]" @click="tab = nt.id">
            <component :is="nt.icon" :size="14" />
            {{ nt.label }}
          </button>
        </div>
      </aside>

      <div class="settings-content">

        <!-- ===== 通用（内容语言） ===== -->
        <div v-if="tab === 'general'" class="settings-scroll">
          <div class="settings-head">
            <h2 class="settings-title">{{ t('settings.general.title') }}</h2>
            <p class="settings-desc">{{ t('settings.general.desc') }}</p>
          </div>
          <section class="card svc-group">
            <div class="svc-group-head">
              <div class="svc-group-heading">
                <span class="svc-group-title">{{ t('settings.general.contentLanguage') }}</span>
                <div class="svc-group-sub">{{ t('settings.general.contentLanguageSub') }}</div>
              </div>
            </div>
            <div class="config-row">
              <div class="provider-badge" style="background:var(--accent-bg);color:var(--accent)"><Languages :size="15" /></div>
              <div class="config-main">
                <div class="config-line"><span class="config-name">{{ t('settings.general.languageLabel') }}</span></div>
                <div class="config-sub">{{ t('settings.general.languageNote') }}</div>
              </div>
              <div class="lang-picker lang-picker-wrap">
                <button
                  v-for="l in contentLangOptions"
                  :key="l.value"
                  type="button"
                  :class="['lang-option', { on: contentLanguage === l.value }]"
                  @click="setContentLanguage(l.value)"
                >{{ l.label }}</button>
              </div>
            </div>
            <p class="config-empty">{{ t('settings.general.languageHint') }}</p>
          </section>

          <!-- 外观主题 -->
          <section class="card svc-group">
            <div class="svc-group-head">
              <div class="svc-group-heading">
                <span class="svc-group-title">{{ t('settings.general.appearance') }}</span>
                <div class="svc-group-sub">{{ t('settings.general.appearanceSub') }}</div>
              </div>
            </div>
            <div class="config-row">
              <div class="provider-badge" style="background:var(--accent-bg);color:var(--accent)"><SunMoon :size="15" /></div>
              <div class="config-main">
                <div class="config-line"><span class="config-name">{{ t('settings.general.appearanceLabel') }}</span></div>
                <div class="config-sub">{{ t('settings.general.appearanceNote') }}</div>
              </div>
              <div class="lang-picker">
                <button
                  v-for="o in themeOptions"
                  :key="o.value"
                  type="button"
                  :class="['lang-option', { on: themeMode === o.value }]"
                  @click="setThemeMode(o.value)"
                >{{ o.label }}</button>
              </div>
            </div>
          </section>
        </div>

        <!-- ===== AI 服务配置 ===== -->
        <div v-if="tab === 'ai'" class="settings-scroll">
          <div class="settings-head">
            <h2 class="settings-title">{{ t('settings.ai.title') }}</h2>
            <p class="settings-desc">{{ t('settings.ai.desc') }}</p>
          </div>
          <section class="card quick-card">
            <div class="quick-card-head">
              <div class="setup-title">{{ t('settings.ai.quickTitle') }}</div>
              <span class="tag tag-accent">{{ t('settings.ai.recommended') }}</span>
            </div>
            <p class="setup-desc">
              {{ t('settings.ai.quickDesc') }}
              <a class="quick-site-link" :href="AIASK_SITE_URL" target="_blank" rel="noopener noreferrer">
                {{ t('settings.ai.getKey') }}
                <ExternalLink :size="12" :stroke-width="1.8" />
              </a>
            </p>
            <div class="quick-row">
              <input v-model="aiaskApiKey" class="input" type="password" placeholder="aiask.me API Key" />
              <button class="btn btn-primary" :disabled="aiaskSaving" @click="applyAiaskQuickConfig">
                <Loader2 v-if="aiaskSaving" :size="13" class="animate-spin" />
                <Sparkles v-else :size="13" />
                {{ t('settings.ai.applyQuick') }}
              </button>
            </div>
            <div class="quick-models">
              <div v-for="q in aiaskQuickConfigs" :key="q.name" class="hqm-row">
                <span class="hqm-label">{{ serviceMeta[q.service_type].label }}</span>
                <span class="hqm-provider">
                  <img v-if="providerIconUrl(q.provider)" :src="providerIconUrl(q.provider)" class="hqm-provider-icon" alt="" />
                  {{ q.provider }}
                </span>
                <span class="hqm-models mono">
                  <span v-for="(m, i) in q.model" :key="m" :class="['hqm-model', { 'is-default': i === 0 }]">
                    {{ m }}<em v-if="i === 0">{{ t('common.default') }}</em>
                  </span>
                </span>
              </div>
            </div>
          </section>
          <section class="card setup-panel">
            <div class="setup-panel-head compact">
              <div>
                <div class="setup-title">{{ t('settings.ai.manualTitle') }}</div>
                <div class="setup-desc">{{ t('settings.ai.manualDesc') }}</div>
              </div>
            </div>
            <div class="template-row">
              <button
                v-for="st in serviceTypes"
                :key="st.type"
                class="template-type-chip"
                @click="startAddCfg(st.type)"
              >
                {{ st.label }}
              </button>
            </div>
          </section>
          <div class="sections">
            <section v-for="st in serviceTypes" :key="st.type" class="card svc-group">
              <div class="svc-group-head">
                <div class="svc-group-heading">
                  <span class="svc-group-title">{{ st.label }}</span>
                  <div class="svc-group-sub">{{ serviceMeta[st.type].desc }}</div>
                </div>
                <span v-if="countActive(st.type)" class="tag tag-accent">{{ t('settings.ai.activeCount', { n: countActive(st.type) }) }}</span>
                <button class="btn btn-ghost btn-sm ml-auto" @click="startAddCfg(st.type)"><Plus :size="13" /> {{ t('common.add') }}</button>
              </div>
              <div v-for="c in byType(st.type)" :key="c.id" class="config-row">
                <div class="provider-badge" :class="{ 'has-icon': !!providerIconUrl(c.provider) }" :data-provider="c.provider">
                  <img v-if="providerIconUrl(c.provider)" class="provider-badge-icon" :src="providerIconUrl(c.provider)" alt="" />
                  <template v-else>{{ c.provider.slice(0, 1).toUpperCase() }}</template>
                </div>
                <div class="config-main">
                  <div class="config-line">
                    <span class="config-name">{{ c.name || `${c.provider}-${c.service_type}` }}</span>
                    <!-- 本地服务默认无鉴权，不提示缺密钥 -->
                    <span v-if="!LOCAL_BASE_URLS[c.provider] || c.api_key" :class="['tag', c.api_key ? 'tag-success' : 'tag-error']">{{ c.api_key ? t('settings.ai.hasKey') : t('settings.ai.noKey') }}</span>
                    <span v-if="!c.is_active" class="tag">{{ t('settings.common.disabled') }}</span>
                  </div>
                  <div class="config-models">
                    <button
                      v-for="m in c.model" :key="m" type="button"
                      :class="['cfg-model-chip mono', { 'is-default': isDefaultModel(st.type, c, m) }]"
                      :title="isDefaultModel(st.type, c, m) ? t('settings.ai.currentDefault') : t('settings.ai.setDefault')"
                      @click="setDefaultModel(st.type, c, m)"
                    >
                      <Star v-if="isDefaultModel(st.type, c, m)" :size="9" class="cfg-model-star" />
                      {{ m }}
                    </button>
                  </div>
                  <div class="config-sub mono truncate">{{ c.base_url || t('settings.ai.noBaseUrl') }}</div>
                </div>
                <button v-if="st.type === 'text' || ['aiask', 'xai', 'veo', 'runway', 'comfyui', 'sdwebui', 'fooocus'].includes(c.provider)" class="btn btn-ghost btn-sm" @click="testExistingCfg(c)">{{ t('settings.ai.test') }}</button>
                <label class="config-switch">
                  <input type="checkbox" class="sr-only" :checked="c.is_active" @change="toggleCfg(c)">
                  <span class="switch" :class="{ on: c.is_active }"></span>
                </label>
                <button class="btn btn-ghost btn-icon btn-sm" @click="startEditCfg(c)"><Pencil :size="13" /></button>
                <button class="btn btn-danger btn-icon btn-sm" @click="delCfg(c.id)"><Trash2 :size="13" /></button>
              </div>
              <p v-if="!byType(st.type).length" class="config-empty">{{ t('settings.common.empty') }}</p>
            </section>
          </div>
        </div>

        <!-- ===== 风格预设 ===== -->
        <div v-else-if="tab === 'styles'" class="settings-scroll">
          <div class="settings-head">
            <h2 class="settings-title">{{ t('settings.styles.title') }}</h2>
            <p class="settings-desc">{{ t('settings.styles.desc') }}</p>
          </div>
          <section class="card svc-group">
            <div class="svc-group-head">
              <div class="svc-group-heading">
                <span class="svc-group-title">{{ t('settings.styles.allTitle') }}</span>
                <div class="svc-group-sub">{{ t('settings.styles.count', { active: stylePresets.filter(p => p.is_active).length, total: stylePresets.length }) }}</div>
              </div>
              <button class="btn btn-ghost btn-sm ml-auto" @click="startAddStyle"><Plus :size="13" /> {{ t('common.add') }}</button>
            </div>
            <div v-for="p in stylePresets" :key="p.id" class="config-row">
              <div class="provider-badge style-badge"><Palette :size="15" /></div>
              <div class="config-main">
                <div class="config-line">
                  <span class="config-name">{{ p.name }}</span>
                  <span class="tag mono">{{ p.value }}</span>
                  <span v-if="!p.is_active" class="tag">{{ t('settings.common.disabled') }}</span>
                </div>
                <div class="config-sub mono truncate">{{ p.prompt }}</div>
                <div v-if="p.description" class="config-sub truncate">{{ p.description }}</div>
              </div>
              <label class="config-switch">
                <input type="checkbox" class="sr-only" :checked="p.is_active" @change="toggleStyle(p)">
                <span class="switch" :class="{ on: p.is_active }"></span>
              </label>
              <button class="btn btn-ghost btn-icon btn-sm" @click="startEditStyle(p)"><Pencil :size="13" /></button>
              <button class="btn btn-danger btn-icon btn-sm" @click="styleToDelete = p"><Trash2 :size="13" /></button>
            </div>
            <p v-if="!stylePresets.length" class="config-empty">{{ t('settings.styles.empty') }}</p>
          </section>
        </div>

        <!-- ===== 存储位置 ===== -->
        <div v-else-if="tab === 'storage'" class="settings-scroll">
          <div class="settings-head">
            <h2 class="settings-title">{{ t('settings.storage.title') }}</h2>
            <p class="settings-desc">{{ t('settings.storage.desc') }}</p>
          </div>
          <section class="card svc-group">
            <div class="svc-group-head">
              <div class="svc-group-heading">
                <span class="svc-group-title">{{ t('settings.storage.currentDir') }}</span>
                <div v-if="storageInfo?.computedAt" class="svc-group-sub">{{ t('settings.storage.computedAt', { time: new Date(storageInfo.computedAt).toLocaleString() }) }}</div>
              </div>
              <button v-if="isDesktopMode" class="btn btn-primary btn-sm ml-auto" :disabled="migrating" @click="pickTarget">
                <HardDrive :size="13" /> {{ t('settings.storage.changeLocation') }}
              </button>
            </div>
            <div class="config-row">
              <div class="provider-badge style-badge"><HardDrive :size="15" /></div>
              <div class="config-main">
                <div class="config-line"><span class="config-name">{{ t('settings.storage.dataDir') }}</span><span class="tag mono">{{ storageInfo?.mode === 'desktop' ? t('settings.storage.desktopMode') : t('settings.storage.serverMode') }}</span></div>
                <div class="config-sub mono truncate">{{ storageInfo?.dataDir || t('common.loading') }}</div>
                <div class="config-sub mono truncate">{{ storageInfo?.sqlitePath || '' }}</div>
              </div>
            </div>
            <div v-if="storageInfo?.usage" class="config-row">
              <div class="provider-badge style-badge"><Database :size="15" /></div>
              <div class="config-main">
                <div class="config-line">
                  <span class="config-name">{{ t('settings.storage.totalUsage', { size: formatBytes(storageInfo.usage.total) }) }}</span>
                  <span v-if="storageInfo.usageStale" class="tag">{{ t('settings.storage.counting') }}</span>
                </div>
                <div class="storage-breakdown">
                  <span class="tag mono">{{ t('settings.storage.breakdown.db') }} {{ formatBytes(storageInfo.usage.db) }}</span>
                  <span class="tag mono">{{ t('settings.storage.breakdown.images') }} {{ formatBytes(storageInfo.usage.images) }}</span>
                  <span class="tag mono">{{ t('settings.storage.breakdown.videos') }} {{ formatBytes(storageInfo.usage.videos) }}</span>
                  <span class="tag mono">{{ t('settings.storage.breakdown.merged') }} {{ formatBytes(storageInfo.usage.merged) }}</span>
                  <span class="tag mono">{{ t('settings.storage.breakdown.uploads') }} {{ formatBytes(storageInfo.usage.uploads) }}</span>
                  <span v-if="storageInfo.usage.temp" class="tag mono">{{ t('settings.storage.breakdown.temp') }} {{ formatBytes(storageInfo.usage.temp) }}</span>
                  <span v-if="storageInfo.usage.other" class="tag mono">{{ t('settings.storage.breakdown.other') }} {{ formatBytes(storageInfo.usage.other) }}</span>
                </div>
                <div v-if="storageInfo.freeBytes != null" class="config-sub">{{ t('settings.storage.diskFree', { size: formatBytes(storageInfo.freeBytes) }) }}</div>
              </div>
            </div>
            <p class="config-empty">{{ t('settings.storage.note') }}</p>
            <p v-if="!isDesktopMode" class="config-empty">{{ t('settings.storage.serverNote') }}</p>
          </section>
        </div>

        <!-- ===== 关于更新 ===== -->
        <div v-else-if="tab === 'about'" class="settings-scroll">
          <div class="settings-head">
            <h2 class="settings-title">{{ t('settings.about.title') }}</h2>
            <p class="settings-desc">{{ t('settings.about.desc') }}</p>
          </div>
          <section class="card svc-group">
            <div class="svc-group-head">
              <div class="svc-group-heading">
                <span class="svc-group-title">{{ t('settings.about.currentVersion', { v: updateState?.currentVersion || '…' }) }}</span>
                <div v-if="updateState?.latestVersion" class="svc-group-sub">{{ t('settings.about.latestVersion', { v: updateState.latestVersion }) }}</div>
              </div>
              <button class="btn btn-primary btn-sm ml-auto" :disabled="updateChecking" @click="checkUpdate">
                <Loader2 v-if="updateChecking" :size="13" class="animate-spin" />
                <RefreshCw v-else :size="13" />
                {{ t('settings.about.check') }}
              </button>
            </div>

            <div v-if="updateState?.status === 'up-to-date'" class="config-row">
              <div class="provider-badge style-badge"><Check :size="15" /></div>
              <div class="config-main"><div class="config-line"><span class="config-name">{{ t('settings.about.upToDate') }}</span></div></div>
            </div>
            <div v-else-if="updateState?.status === 'available' || updateState?.status === 'downloading'" class="config-row">
              <div class="provider-badge style-badge"><Sparkles :size="15" /></div>
              <div class="config-main">
                <div class="config-line"><span class="config-name">{{ t('settings.about.found', { v: updateState.latestVersion }) }}</span></div>
                <div v-if="updateState.notes" class="config-sub">{{ updateState.notes }}</div>
                <div v-if="updateState.status === 'downloading' || updateDownloading" class="update-bar">
                  <div class="update-bar-fill" :style="{ width: `${updateProgress}%` }"></div>
                </div>
                <!-- 服务器手动模式：无 Watchtower，给出更新命令 -->
                <div v-if="!desktopBridge && serverUpdateMode === 'manual'" class="config-sub">
                  {{ t('settings.about.serverManualHint') }} <span class="mono">docker compose pull && docker compose up -d</span>
                </div>
              </div>
              <!-- 桌面版：下载更新包 -->
              <button v-if="desktopBridge" class="btn btn-primary btn-sm" :disabled="updateDownloading" @click="downloadUpdate">
                <Loader2 v-if="updateDownloading" :size="13" class="animate-spin" />
                <Download v-else :size="13" />
                {{ updateDownloading ? t('settings.about.downloading', { p: updateProgress }) : t('settings.about.download') }}
              </button>
              <!-- 服务器 + Watchtower：一键触发拉镜像重建 -->
              <button v-else-if="serverUpdateMode === 'watchtower'" class="btn btn-primary btn-sm" :disabled="updateApplying" @click="applyUpdate">
                <Loader2 v-if="updateApplying" :size="13" class="animate-spin" />
                <Download v-else :size="13" />
                {{ t('settings.about.serverApply') }}
              </button>
            </div>
            <div v-else-if="updateState?.status === 'downloaded'" class="config-row">
              <div class="provider-badge style-badge"><Download :size="15" /></div>
              <div class="config-main">
                <div class="config-line"><span class="config-name">{{ t('settings.about.ready') }}</span></div>
                <div class="config-sub">{{ t('settings.about.readyDesc') }}</div>
              </div>
              <button class="btn btn-primary btn-sm" :disabled="updateApplying" @click="applyUpdate">
                <Loader2 v-if="updateApplying" :size="13" class="animate-spin" />
                {{ t('settings.about.restartInstall') }}
              </button>
            </div>
            <div v-else-if="updateState?.status === 'error'" class="config-row">
              <div class="provider-badge style-badge"><RefreshCw :size="15" /></div>
              <div class="config-main">
                <div class="config-line"><span class="config-name">{{ t('settings.about.checkFailed') }}</span></div>
                <div class="config-sub">{{ updateState.error }}</div>
              </div>
              <button class="btn btn-ghost btn-sm" @click="checkUpdate">{{ t('settings.about.retry') }}</button>
            </div>
            <p v-else class="config-empty">{{ t('settings.about.empty') }}</p>
          </section>
          <p v-if="desktopBridge" class="config-empty">{{ t('settings.about.note') }}</p>
          <p v-else class="config-empty">{{ t('settings.about.serverNote') }}</p>
        </div>

        <!-- ===== Agent 配置（左侧 tab 切换，Prompt 与 Skills 整合在同一 Agent 下） ===== -->
        <div v-else-if="tab === 'agents'" class="skills-layout">
          <!-- Agent 左侧 tab 列表 -->
          <aside class="skills-agent-list">
            <div class="skills-agent-title">{{ t('settings.skills.agentList') }}</div>
            <button
              v-for="a in agentDefs"
              :key="a.type"
              :class="['skills-agent-item', { active: selectedAgent === a.type }]"
              @click="selectAgent(a.type)"
            >
              <span class="agent-type-badge">{{ a.icon }}</span>
              <span class="skills-agent-label">{{ a.label }}</span>
              <span v-if="agentSkillCount(a.type) > 0" class="skill-count-badge">{{ agentSkillCount(a.type) }}</span>
            </button>
          </aside>

          <!-- 右侧主区域 -->
          <div class="settings-scroll skills-main">
            <div class="settings-head skills-head">
              <span class="agent-type-badge skills-head-badge">{{ selectedAgentIcon }}</span>
              <div class="skills-head-copy">
                <h2 class="settings-title">{{ selectedAgentLabel }}</h2>
                <div class="dim" style="font-size:12px;margin-top:2px;display:flex;align-items:center;gap:6px">
                  {{ selectedAgentType }}
                  <span v-if="getAgentCfg(selectedAgent) && !getAgentCfg(selectedAgent).is_default" class="tag tag-success">{{ t('settings.common.custom') }}</span>
                  <span v-else class="tag">{{ t('common.default') }}</span>
                </div>
              </div>
              <button v-if="agentPane === 'skills'" class="btn btn-primary btn-sm ml-auto" @click="startAddSkill">
                <Plus :size="13" /> {{ t('settings.skills.add') }}
              </button>
            </div>

            <!-- Prompt 面板（子 tab 作为卡片头，与卡片同宽对齐） -->
            <div v-if="agentPane === 'prompt'" class="card agent-card">
              <div class="agent-pane-tabs">
                <div class="agent-pane-tabs-nav">
                  <button :class="['agent-pane-tab', { active: agentPane === 'prompt' }]" @click="agentPane = 'prompt'">System Prompt</button>
                  <button :class="['agent-pane-tab', { active: agentPane === 'skills' }]" @click="agentPane = 'skills'">
                    Skills<template v-if="agentSkillCount(selectedAgent) > 0"> ({{ agentSkillCount(selectedAgent) }})</template>
                  </button>
                </div>
                <span class="agent-lang-follow dim">
                  {{ t('settings.agents.followContentLang', { lang: contentLangLabel }) }}
                </span>
              </div>
              <div class="agent-card-body">
                <label class="field">
                  <span class="field-label">System Prompt <span class="dim">({{ t('settings.agents.promptHint', { file: promptFileName }) }})</span>
                    <span v-if="agentPromptFallback" class="tag agent-fallback-tag">{{ t('settings.agents.langFallback') }}</span>
                  </span>
                  <textarea v-model="agentForm.system_prompt" class="textarea agent-prompt-input" rows="16" :placeholder="t('settings.agents.promptPlaceholder')" />
                </label>
                <div class="agent-card-foot">
                  <button class="btn btn-ghost btn-sm" @click="resetAgentPrompt(selectedAgent)">{{ t('settings.agents.reset') }}</button>
                  <span v-if="agentSaved === selectedAgent" class="tag tag-success" style="margin-left:8px">
                    <Check :size="10" /> {{ t('common.saved') }}
                  </span>
                  <button class="btn btn-primary btn-sm ml-auto" :disabled="agentSaving" @click="saveAgentCfg(selectedAgent)">
                    <Loader2 v-if="agentSaving" :size="12" class="animate-spin" />
                    {{ t('common.save') }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Skills 面板（子 tab 同为卡片头） -->
            <template v-else>
              <div class="agent-pane-tabs-wrap card">
                <div class="agent-pane-tabs">
                  <div class="agent-pane-tabs-nav">
                    <button :class="['agent-pane-tab', { active: agentPane === 'prompt' }]" @click="agentPane = 'prompt'">System Prompt</button>
                    <button :class="['agent-pane-tab', { active: agentPane === 'skills' }]" @click="agentPane = 'skills'">
                      Skills<template v-if="agentSkillCount(selectedAgent) > 0"> ({{ agentSkillCount(selectedAgent) }})</template>
                    </button>
                  </div>
                  <span class="agent-lang-follow dim">
                    {{ t('settings.agents.followContentLang', { lang: contentLangLabel }) }}
                  </span>
                </div>
              </div>
              <p class="settings-desc" style="margin-top:0">{{ t('settings.skills.desc') }}</p>

              <!-- 无 skill 提示 -->
              <div v-if="!currentSkills.length" class="card skills-empty">
                <div class="skills-empty-icon">
                  <FileText :size="24" />
                </div>
                <div class="skills-empty-title">{{ t('settings.skills.emptyTitle') }}</div>
                <div class="skills-empty-desc">{{ t('settings.skills.emptyDesc') }}</div>
              </div>

              <!-- Skill 列表 -->
              <div class="skill-list" v-else>
                <div v-for="s in currentSkills" :key="s.id" class="card skill-card">
                  <div class="skill-card-head" @click="toggleSkillEdit(s.id)">
                    <FileText :size="14" style="color:var(--accent);flex-shrink:0" />
                    <div style="flex:1;min-width:0">
                      <div style="font-weight:600;font-size:13px">{{ s.name }}</div>
                      <div class="dim" style="font-size:11px">{{ s.description }}</div>
                    </div>
                    <button class="btn btn-danger btn-icon btn-sm" style="margin-right:4px" @click.stop="skillToDelete = s.id">
                      <Trash2 :size="13" />
                    </button>
                    <ChevronDown :size="14" :style="{ transform: editingSkill === s.id ? 'rotate(180deg)' : '', transition: '0.2s' }" />
                  </div>
                  <div v-if="editingSkill === s.id" class="skill-card-body">
                    <textarea
                      v-model="skillContent"
                      class="textarea mono skill-content-input"
                      rows="20"
                      style="font-size:12px;line-height:1.6"
                      :placeholder="t('settings.skills.contentPlaceholder')"
                    />
                    <div class="skill-card-foot">
                      <span class="dim" style="font-size:11px">skills/{{ s.id }}/{{ skillFileName }}</span>
                      <span v-if="skillContentFallback" class="tag agent-fallback-tag">{{ t('settings.agents.langFallback') }}</span>
                      <span v-if="skillSaved === s.id" class="tag tag-success" style="margin-left:8px">
                        <Check :size="10" /> {{ t('common.saved') }}
                      </span>
                      <button class="btn btn-primary btn-sm ml-auto" :disabled="skillSaving" @click="saveSkill(s.id)">
                        <Loader2 v-if="skillSaving" :size="12" class="animate-spin" />
                        {{ t('common.save') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Config Dialog -->
    <!-- 点遮罩不关闭：API 配置常常填到一半，误点外面会丢掉已填内容；只能用右上角关闭 / 取消 / 保存 -->
    <div v-if="cfgDialog" class="overlay" @click.self="nudgeCfgDialog">
      <form :class="['dialog', 'config-dialog', { 'is-nudged': cfgNudge }]" @submit.prevent="saveCfg">
        <div class="dialog-head">
          <div>
            <div class="dialog-title">{{ cfgEditId ? t('settings.cfg.editTitle') : t('settings.cfg.addTitle', { type: serviceMeta[cfgForm.service_type].label }) }}</div>
            <div class="dialog-sub">{{ t('settings.cfg.sub') }}</div>
          </div>
          <span class="tag tag-accent ml-auto">{{ serviceMeta[cfgForm.service_type].label }}</span>
          <button
            type="button"
            class="dialog-close-btn"
            :title="t('settings.cfg.close')"
            :aria-label="t('settings.cfg.close')"
            @click="closeCfgDialog"
          >
            <X :size="18" :stroke-width="2.4" />
            <span>{{ t('settings.cfg.close') }}</span>
          </button>
        </div>
        <div v-if="cfgOutsideHint" class="cfg-outside-hint" role="status">{{ t('settings.cfg.outsideHint') }}</div>
        <div class="dialog-body config-dialog-body">
          <div class="preset-picker">
            <button
              v-for="preset in presetsByType(cfgForm.service_type)"
              :key="`${cfgForm.service_type}-${preset.provider}`"
              type="button"
              class="preset-pill"
              @click="applyProviderPreset(cfgForm.service_type, preset.provider)"
            >
              {{ preset.label }}
            </button>
          </div>
          <details v-if="cfgGuide" class="cfg-guide" :open="!cfgEditId">
            <summary class="cfg-guide-summary">
              <BookOpen :size="14" />
              <span class="cfg-guide-title">{{ t('settings.cfg.guide.title') }}</span>
              <span class="cfg-guide-sub">{{ cfgGuide.summary }}</span>
            </summary>
            <div class="cfg-guide-body">
              <p class="cfg-guide-usage">{{ serviceUsage }}</p>
              <div class="cfg-guide-section">{{ t('settings.cfg.guide.steps') }}</div>
              <ol class="cfg-guide-steps">
                <li v-for="(step, i) in cfgGuide.steps" :key="i">{{ step }}</li>
              </ol>
              <div class="cfg-guide-section">{{ t('settings.cfg.guide.fields') }}</div>
              <table class="cfg-guide-fields">
                <tr v-for="[k, v] in cfgGuide.fields" :key="k"><th>{{ k }}</th><td>{{ v }}</td></tr>
              </table>
              <template v-if="cfgGuide.tips.length">
                <div class="cfg-guide-section">{{ t('settings.cfg.guide.tips') }}</div>
                <ul class="cfg-guide-tips">
                  <li v-for="(tip, i) in cfgGuide.tips" :key="i">{{ tip }}</li>
                </ul>
              </template>
              <div v-if="cfgGuide.links.length" class="cfg-guide-links">
                <a v-for="[label, url] in cfgGuide.links" :key="url" :href="url" target="_blank" rel="noopener">{{ label }} ↗</a>
              </div>
            </div>
          </details>
          <label class="field">
            <span class="field-label">{{ t('settings.cfg.name') }}</span>
            <input v-model="cfgForm.name" class="input" :placeholder="t('settings.cfg.namePlaceholder')" />
          </label>
          <label class="field"><span class="field-label">{{ t('settings.cfg.provider') }}</span>
            <BaseSelect v-model="cfgForm.provider" :options="providerSelectOptions" :placeholder="t('settings.cfg.providerPlaceholder')" searchable />
          </label>
          <label class="field">
            <span class="field-label">{{ t('settings.cfg.priority') }}</span>
            <input v-model.number="cfgForm.priority" class="input" type="number" min="0" max="999" />
            <span class="field-hint">{{ t('settings.cfg.priorityHint') }}</span>
          </label>
          <label class="field">
            <span class="field-label">API Key <span v-if="isLocalForm" class="dim">({{ t('settings.cfg.local.apiKeyOptional') }})</span></span>
            <input v-model="cfgForm.api_key" class="input" type="password" :placeholder="isLocalForm ? t('settings.cfg.local.apiKeyPlaceholder') : 'sk-...'" />
          </label>
          <label class="field"><span class="field-label">Base URL</span><input v-model="cfgForm.base_url" class="input" :placeholder="LOCAL_BASE_URLS[cfgForm.provider] || 'https://...'" /></label>
          <div class="field">
            <span class="field-label">{{ t('settings.cfg.models') }}</span>
            <div v-if="cfgForm.models.length" class="model-chips">
              <span
                v-for="(m, i) in cfgForm.models" :key="`${m}-${i}`"
                :class="['model-chip', { 'is-default': i === 0 }]"
                :title="t('settings.cfg.modelChipHint')"
                @click="pinModelTop(i)"
              >
                {{ m }}<em v-if="i === 0">{{ t('common.default') }}</em>
                <button type="button" class="model-chip-x" :title="t('common.delete')" @click.stop="removeModel(i)"><X :size="11" /></button>
              </span>
            </div>
            <div class="model-add-row">
              <input
                v-model="modelInput" class="input" :placeholder="t('settings.cfg.modelPlaceholder')"
                @keydown.enter.prevent="addModel"
                @paste="onModelPaste"
              />
              <button type="button" class="btn btn-sm" :disabled="!modelInput.trim()" @click="addModel">{{ t('common.add') }}</button>
            </div>
            <span class="field-hint">{{ t('settings.cfg.modelsHint') }}</span>
          </div>
          <!-- ===== 本地服务：ComfyUI ===== -->
          <template v-if="isComfyForm">
            <div class="field">
              <span class="field-label">{{ t('settings.cfg.comfy.source') }}</span>
              <div class="seg-switch" role="tablist">
                <button type="button" :class="['seg-btn', { active: comfySource === 'builtin' }]" @click="comfySource = 'builtin'">{{ t('settings.cfg.comfy.sourceBuiltin') }}</button>
                <button type="button" :class="['seg-btn', { active: comfySource === 'custom' }]" @click="comfySource = 'custom'">{{ t('settings.cfg.comfy.sourceCustom') }}</button>
              </div>
            </div>
            <template v-if="comfySource === 'builtin'">
              <label class="field">
                <span class="field-label">{{ t('settings.cfg.comfy.template') }}</span>
                <select v-model="cfgForm.comfyui_template" class="input">
                  <option value="">{{ t('settings.cfg.comfy.templateAuto') }}</option>
                  <template v-if="comfyVramGroups.length">
                    <optgroup v-for="g in comfyVramGroups" :key="g.family" :label="t('settings.cfg.comfy.groupVram', { family: g.family })">
                      <option v-for="tpl in g.list" :key="tpl.id" :value="tpl.id">{{ tpl.label }}</option>
                    </optgroup>
                    <optgroup :label="t('settings.cfg.comfy.groupOther')">
                      <option v-for="tpl in comfyOtherTemplates" :key="tpl.id" :value="tpl.id">{{ tpl.label }}</option>
                    </optgroup>
                  </template>
                  <template v-else>
                    <option v-for="tpl in comfyOtherTemplates" :key="tpl.id" :value="tpl.id">{{ tpl.label }}</option>
                  </template>
                </select>
                <span class="field-hint">{{ t('settings.cfg.comfy.templateHint') }}</span>
              </label>
              <div v-if="activeComfyTemplate" class="tpl-card">
                <div class="tpl-card-head">
                  <strong>{{ activeComfyTemplate.label }}</strong>
                  <span v-if="activeComfyTemplate.vram" class="tag">{{ t('settings.cfg.comfy.vramTag', { n: activeComfyTemplate.vram }) }}</span>
                  <span class="tag">{{ t('settings.cfg.comfy.needsImage.' + (activeComfyTemplate.needs_image || 'none')) }}</span>
                  <span v-if="activeComfyTemplate.recommended?.maxShortEdge" class="tag">{{ t('settings.cfg.comfy.maxResTag', { n: activeComfyTemplate.recommended.maxShortEdge }) }}</span>
                  <span v-if="activeComfyTemplate.recommended?.fps" class="tag">{{ activeComfyTemplate.recommended.fps }} fps</span>
                  <span v-if="activeComfyTemplate.recommended?.steps" class="tag">{{ t('settings.cfg.comfy.stepsTag', { n: activeComfyTemplate.recommended.steps }) }}</span>
                  <span v-if="activeComfyTemplate.recommended?.baseSize" class="tag">{{ activeComfyTemplate.recommended.baseSize }}px</span>
                </div>
                <p class="tpl-card-desc">{{ locale === 'zh' ? activeComfyTemplate.description : activeComfyTemplate.description_en }}</p>
                <div class="tpl-files">
                  <div class="tpl-files-title">{{ t('settings.cfg.comfy.filesTitle') }}</div>
                  <div v-for="f in activeComfyTemplate.files" :key="f.file" class="tpl-file">
                    <span class="mono tpl-file-path">ComfyUI/{{ f.folder }}/<b>{{ f.file }}</b></span>
                    <a :href="f.url" target="_blank" rel="noopener" class="tpl-file-link">{{ t('settings.cfg.comfy.download') }}</a>
                  </div>
                </div>
                <div class="tpl-card-actions">
                  <button type="button" class="btn btn-sm" @click="useTemplateAsModel">{{ t('settings.cfg.comfy.useTemplateModel', { model: activeComfyTemplate.default_model }) }}</button>
                  <button type="button" class="btn btn-sm" @click="copyTemplateToEditor">{{ t('settings.cfg.comfy.copyToEditor') }}</button>
                </div>
              </div>
            </template>
            <label v-else class="field">
              <span class="field-label">{{ t('settings.cfg.comfy.workflow') }}</span>
              <textarea v-model="cfgForm.comfyui_workflow" class="textarea mono comfy-workflow-input" rows="10" spellcheck="false" :placeholder="t('settings.cfg.comfy.workflowPlaceholder')"></textarea>
              <span class="field-hint">{{ t('settings.cfg.comfy.exportHint') }}</span>
              <span class="field-hint">{{ t('settings.cfg.comfy.placeholders') }}</span>
              <span class="field-hint mono comfy-placeholder-list">{{ cfgForm.service_type === 'image' ? COMFY_IMAGE_PLACEHOLDERS : COMFY_PLACEHOLDERS }}</span>
            </label>
            <label class="check-row">
              <input v-model="cfgForm.comfyui_auto_bind" type="checkbox" />
              <span>
                <b>{{ t('settings.cfg.comfy.autoBind') }}</b>
                <span class="field-hint">{{ cfgForm.service_type === 'image' ? t('settings.cfg.comfy.autoBindHintImage') : t('settings.cfg.comfy.autoBindHint') }}</span>
              </span>
            </label>
            <div v-if="cfgForm.service_type === 'video'" class="local-row">
              <label class="field">
                <span class="field-label">FPS</span>
                <input v-model="cfgForm.comfyui_fps" class="input" type="number" min="1" max="120" :placeholder="String(activeComfyTemplate?.recommended?.fps || t('settings.cfg.comfy.fromWorkflow'))" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('settings.cfg.local.steps') }}</span>
                <input v-model="cfgForm.comfyui_steps" class="input" type="number" min="1" max="200" :placeholder="comfySource === 'builtin' && activeComfyTemplate?.recommended?.steps ? String(activeComfyTemplate.recommended.steps) : t('settings.cfg.comfy.fromWorkflow')" />
              </label>
              <label class="field">
                <span class="field-label">CFG</span>
                <input v-model="cfgForm.comfyui_cfg" class="input" type="number" min="0" max="30" step="0.5" :placeholder="t('settings.cfg.comfy.fromWorkflow')" />
              </label>
            </div>
            <label class="field">
              <span class="field-label">{{ t('settings.cfg.comfy.negativePrompt') }}</span>
              <input v-model="cfgForm.comfyui_negative_prompt" class="input" :placeholder="cfgForm.service_type === 'image' ? t('settings.cfg.local.negativePlaceholder') : t('settings.cfg.comfy.negativePlaceholder')" />
            </label>
          </template>
          <template v-if="isSdForm || isFooocusForm">
            <div class="field">
              <span class="field-label">{{ t('settings.cfg.local.paramPresets') }}</span>
              <div class="preset-picker">
                <template v-if="isSdForm">
                  <button v-for="p in SDWEBUI_PRESETS" :key="p.id" type="button" class="preset-pill" @click="applySdPreset(p)">{{ p.label }}</button>
                </template>
                <template v-else>
                  <button v-for="p in FOOOCUS_PRESETS" :key="p.id" type="button" class="preset-pill" @click="applyFooocusPreset(p)">{{ locale === 'zh' ? p.zh : p.en }}</button>
                </template>
              </div>
              <span class="field-hint">{{ isSdForm ? t('settings.cfg.local.sdHint') : t('settings.cfg.fooocus.hint') }}</span>
            </div>
            <label class="field">
              <span class="field-label">{{ t('settings.cfg.comfy.negativePrompt') }}</span>
              <input v-model="cfgForm.image_negative_prompt" class="input" :placeholder="t('settings.cfg.local.negativePlaceholder')" />
            </label>
          </template>
          <template v-if="showLocalImageParams">
            <div class="local-row">
              <label class="field">
                <span class="field-label">{{ t('settings.cfg.local.baseSize') }}</span>
                <input v-model="cfgForm.image_base_size" class="input" type="number" min="256" max="2048" step="64" :placeholder="String(activeComfyTemplate?.recommended?.baseSize || 1024)" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('settings.cfg.local.steps') }}</span>
                <input v-model="cfgForm.image_steps" class="input" type="number" min="1" max="150" :placeholder="isComfyForm ? t('settings.cfg.comfy.fromWorkflow') : '25'" />
              </label>
              <label class="field">
                <span class="field-label">CFG</span>
                <input v-model="cfgForm.image_cfg_scale" class="input" type="number" min="0" max="30" step="0.5" :placeholder="isComfyForm ? t('settings.cfg.comfy.fromWorkflow') : '7'" />
              </label>
            </div>
            <span class="field-hint">{{ t('settings.cfg.local.baseSizeHint') }}</span>
            <label v-if="isSdForm" class="field">
              <span class="field-label">{{ t('settings.cfg.local.sampler') }}</span>
              <input v-model="cfgForm.image_sampler" class="input" :placeholder="t('settings.cfg.local.samplerPlaceholder')" />
            </label>
          </template>
          <template v-if="isFooocusForm">
            <div class="comfy-row">
              <label class="field">
                <span class="field-label">{{ t('settings.cfg.fooocus.performance') }}</span>
                <select v-model="cfgForm.fooocus_performance" class="input">
                  <option value="">Speed</option>
                  <option v-for="opt in FOOOCUS_PERFORMANCE.slice(1)" :key="opt" :value="opt">{{ opt }}</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">{{ t('settings.cfg.fooocus.styles') }}</span>
                <input v-model="cfgForm.fooocus_styles" class="input" :placeholder="t('settings.cfg.fooocus.stylesPlaceholder')" />
              </label>
            </div>
          </template>
          <!-- 提示词模板 + 中文翻译（全部本地服务） -->
          <template v-if="isLocalMediaForm">
            <div class="field">
              <span class="field-label">{{ t('settings.cfg.local.promptTemplate') }}</span>
              <div class="preset-picker">
                <button
                  v-for="p in promptTemplatePresets"
                  :key="p.id"
                  type="button"
                  :class="['preset-pill', { 'is-on': cfgForm.prompt_template === p.value }]"
                  @click="cfgForm.prompt_template = p.value"
                >{{ locale === 'zh' ? p.zh : p.en }}</button>
              </div>
              <input v-model="cfgForm.prompt_template" class="input mono" :placeholder="t('settings.cfg.local.promptTemplatePlaceholder', { ph: PROMPT_PH })" />
              <span class="field-hint">{{ t('settings.cfg.local.promptTemplateHint', { ph: PROMPT_PH }) }}</span>
              <span class="field-hint prompt-preview"><b>{{ t('settings.cfg.local.preview') }}</b> {{ promptTemplatePreview }}</span>
            </div>
            <label class="check-row">
              <input v-model="cfgForm.prompt_translate" type="checkbox" />
              <span>
                <b>{{ t('settings.cfg.local.translate') }}</b>
                <span class="field-hint">{{ cfgForm.service_type === 'video' ? t('settings.cfg.local.translateHintVideo') : t('settings.cfg.local.translateHint') }}</span>
              </span>
            </label>
            <div class="field">
              <span class="field-label">{{ t('settings.cfg.local.queueTitle') }}</span>
              <div class="queue-row">
                <label class="queue-item">
                  <span>{{ t('settings.cfg.local.queueConcurrent') }}</span>
                  <select v-model="cfgForm.max_concurrent" class="input">
                    <option value="">{{ t('settings.cfg.local.queueOne') }}</option>
                    <option v-for="n in [2, 3, 4]" :key="n" :value="n">{{ n }}</option>
                  </select>
                </label>
                <label v-if="isComfyForm && cfgForm.service_type === 'video'" class="queue-item">
                  <span>{{ t('settings.cfg.local.freeBetween') }}</span>
                  <select v-model="cfgForm.free_vram_between" class="input">
                    <option value="">{{ t('settings.cfg.local.freeAuto') }}</option>
                    <option value="on">{{ t('settings.cfg.local.freeOn') }}</option>
                    <option value="off">{{ t('settings.cfg.local.freeOff') }}</option>
                  </select>
                </label>
              </div>
              <label v-if="isComfyForm && cfgForm.service_type === 'video'" class="check-row queue-restart">
                <input v-model="cfgForm.oom_lower_resolution" type="checkbox" />
                <span>
                  <b>{{ t('settings.cfg.local.oomLower') }}</b>
                  <span class="field-hint">{{ t('settings.cfg.local.oomLowerHint') }}</span>
                </span>
              </label>
              <label v-if="isComfyForm" class="check-row queue-restart">
                <input v-model="cfgForm.auto_restart_comfy" type="checkbox" />
                <span>
                  <b>{{ t('settings.cfg.local.autoRestart') }}</b>
                  <span class="field-hint">{{ t('settings.cfg.local.autoRestartHint') }}</span>
                </span>
              </label>
              <span class="field-hint">{{ t('settings.cfg.local.queueHint') }}</span>
            </div>
            <div class="field">
              <span class="field-label">{{ t('settings.cfg.styleModels.title') }}</span>
              <StyleModelsPanel
                v-model:enabled="cfgForm.style_models_enabled"
                v-model:overrides="cfgForm.style_models"
                :provider="cfgForm.provider"
                :service-type="cfgForm.service_type"
                :base-url="cfgForm.base_url"
                :api-key="cfgForm.api_key"
              />
            </div>
            <ModelInstallerPanel
              v-model:install="cfgForm.model_install"
              v-model:auto-download="cfgForm.style_models_auto_download"
              v-model:prefer-mirror="cfgForm.download_prefer_mirror"
              v-model:civitai-token="cfgForm.civitai_token"
              v-model:hf-token="cfgForm.hf_token"
              :provider="cfgForm.provider"
              :service-type="cfgForm.service_type"
              :base-url="cfgForm.base_url"
              :api-key="cfgForm.api_key"
              :model="cfgForm.models[0] || ''"
              :plan-settings="installerPlanSettings"
              :config-id="cfgEditId"
            />
            <div class="local-tools">
              <button v-if="isComfyForm" type="button" class="btn btn-sm" :disabled="inspecting" @click="inspectComfyWorkflow">
                <Loader2 v-if="inspecting" :size="12" class="animate-spin" />
                {{ t('settings.cfg.comfy.inspect') }}
              </button>
              <button type="button" class="btn btn-sm" :disabled="localModelsLoading" @click="loadLocalModels">
                <Loader2 v-if="localModelsLoading" :size="12" class="animate-spin" />
                {{ t('settings.cfg.local.readModels') }}
              </button>
            </div>
            <div v-if="inspectResult" class="inspect-panel">
              <div class="inspect-head">
                <strong>{{ t('settings.cfg.comfy.inspectTitle') }}</strong>
                <span class="tag">{{ inspectResult.source === 'custom' ? t('settings.cfg.comfy.sourceCustom') : (inspectResult.template?.label || '') }}</span>
                <button type="button" class="btn btn-ghost btn-icon btn-sm ml-auto" @click="inspectResult = null"><X :size="12" /></button>
              </div>
              <table class="inspect-table">
                <thead><tr><th>{{ t('settings.cfg.comfy.colNode') }}</th><th>{{ t('settings.cfg.comfy.colField') }}</th><th>{{ t('settings.cfg.comfy.colTarget') }}</th><th>{{ t('settings.cfg.comfy.colSource') }}</th></tr></thead>
                <tbody>
                  <tr v-for="(b, i) in inspectBindings" :key="i">
                    <td><span class="mono">#{{ b.node_id }}</span> {{ b.title || b.class_type }}</td>
                    <td class="mono">{{ b.input }}</td>
                    <td>{{ bindTargetLabel(b.target) }}<span v-if="b.source === 'override'" class="mono dim"> = {{ b.value }}</span></td>
                    <td><span :class="['tag', 'bind-' + b.source]">{{ t('settings.cfg.comfy.bindSource.' + b.source) }}</span></td>
                  </tr>
                </tbody>
              </table>
              <div v-if="inspectResult.missing_models?.length" class="inspect-warn is-error">
                <b>{{ t('settings.cfg.comfy.missingModels') }}</b>
                <div v-for="m in inspectResult.missing_models" :key="m.value + m.class_type" class="mono">{{ m.class_type }}.{{ m.input }} = {{ m.value }}</div>
              </div>
              <div v-else-if="inspectResult.missing_models && inspectResult.model_files?.length" class="inspect-warn is-ok">{{ t('settings.cfg.comfy.modelsOk', { n: inspectResult.model_files.length }) }}</div>
              <div v-if="inspectResult.comfy_error" class="inspect-warn">{{ inspectResult.comfy_error }}</div>
              <ul v-if="inspectResult.warnings?.length" class="inspect-warnings">
                <li v-for="w in inspectResult.warnings" :key="w">{{ w }}</li>
              </ul>
            </div>
            <div v-if="localModels" class="inspect-panel">
              <div class="inspect-head">
                <strong>{{ t('settings.cfg.local.modelsTitle') }}</strong>
                <span class="field-hint">{{ t('settings.cfg.local.modelsHint') }}</span>
                <button type="button" class="btn btn-ghost btn-icon btn-sm ml-auto" @click="localModels = null"><X :size="12" /></button>
              </div>
              <div v-if="localModels.error" class="inspect-warn is-error">{{ localModels.error }}</div>
              <div v-if="localModels.diagnosis?.message && localModels.diagnosis.message !== localModels.error" class="inspect-warn">{{ localModels.diagnosis.message }}</div>
              <div v-for="g in localModels.groups" :key="g.key" class="model-group">
                <div class="model-group-title">{{ g.label }}<span v-if="g.folder" class="mono dim"> · ComfyUI/{{ g.folder }}</span> <span class="dim">({{ g.items.length }})</span></div>
                <div class="model-chips">
                  <button v-for="item in g.items.slice(0, 80)" :key="item" type="button" class="model-chip model-pick" @click="pickLocalItem(g.key, item)">{{ item }}</button>
                  <span v-if="!g.items.length" class="dim">{{ t('settings.cfg.local.modelsEmpty') }}</span>
                </div>
              </div>
            </div>
          </template>
          <label v-if="cfgForm.service_type === 'text'" class="field">
            <span class="field-label">Temperature <span class="dim">({{ t('settings.cfg.tempHint') }})</span></span>
            <input v-model="cfgForm.temperature" class="input" type="number" step="0.1" min="0" max="2" :placeholder="t('settings.cfg.tempPlaceholder')" />
            <span class="field-hint">{{ t('settings.cfg.tempNote') }}</span>
          </label>
          <div v-if="cfgTestResult" class="test-result" :class="{ ok: cfgTestResult.reachable, bad: !cfgTestResult.reachable }">
            <div class="test-result-head">
              <span class="tag" :class="cfgTestResult.reachable ? 'tag-success' : 'tag-error'">{{ cfgTestResult.status || 'ERROR' }}</span>
              <span>{{ cfgTestResult.message }}</span>
            </div>
            <div class="mono test-result-url">{{ cfgTestResult.method }} {{ cfgTestResult.url }}</div>
            <div v-if="cfgTestResult.diagnosis?.label" class="test-result-diag">{{ t('settings.cfg.diagnosis', { name: cfgTestResult.diagnosis.label }) }}</div>
            <div v-if="cfgTestResult.response_preview" class="mono test-result-preview">{{ cfgTestResult.response_preview }}</div>
          </div>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn btn-ghost test-draft-btn" :disabled="cfgTesting" @click="testDraftCfg">
            <Loader2 v-if="cfgTesting" :size="12" class="animate-spin" />
            <span v-else>{{ t('settings.cfg.test') }}</span>
          </button>
          <button type="button" class="btn" @click="closeCfgDialog">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn btn-primary">{{ t('common.save') }}</button>
        </div>
      </form>
    </div>

    <!-- Add Skill Dialog -->
    <div v-if="addSkillDialog" class="overlay" @click.self="addSkillDialog = false">
      <form class="dialog skill-dialog" @submit.prevent="confirmAddSkill">
        <div class="dialog-head">
          <div class="dialog-title">{{ t('settings.skills.addTitle', { agent: selectedAgentLabel }) }}</div>
        </div>
        <div class="dialog-body skill-dialog-body">
          <label class="field">
            <span class="field-label">{{ t('settings.skills.dirName') }} <span class="dim">({{ t('settings.skills.dirNameHint') }})</span></span>
            <input v-model="newSkillForm.id" class="input" :placeholder="t('settings.skills.dirNamePlaceholder')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('settings.skills.name') }}</span>
            <input v-model="newSkillForm.name" class="input" :placeholder="t('settings.skills.namePlaceholder')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('settings.skills.description') }}</span>
            <input v-model="newSkillForm.description" class="input" :placeholder="t('settings.skills.descPlaceholder')" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="addSkillDialog = false">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn btn-primary" :disabled="!newSkillForm.id">{{ t('settings.skills.create') }}</button>
        </div>
      </form>
    </div>

    <!-- Style Preset Dialog -->
    <div v-if="styleDialog" class="overlay" @click.self="styleDialog = false">
      <form class="dialog config-dialog" @submit.prevent="saveStyle">
        <div class="dialog-head">
          <div>
            <div class="dialog-title">{{ styleEditId ? t('settings.styleDialog.editTitle') : t('settings.styleDialog.addTitle') }}</div>
            <div class="dialog-sub">{{ t('settings.styleDialog.sub') }}</div>
          </div>
          <span class="tag tag-accent ml-auto"><Palette :size="12" /> {{ t('settings.styleDialog.tag') }}</span>
        </div>
        <div class="dialog-body config-dialog-body">
          <label class="field">
            <span class="field-label">{{ t('settings.styleDialog.name') }} <span class="required">*</span></span>
            <input v-model="styleForm.name" class="input" :placeholder="t('settings.styleDialog.namePlaceholder')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('settings.styleDialog.key') }} <span class="required">*</span></span>
            <input v-model="styleForm.value" class="input mono" :placeholder="t('settings.styleDialog.keyPlaceholder')" :disabled="!!styleEditId" />
            <span class="field-hint">{{ t('settings.styleDialog.keyHint') }}</span>
          </label>
          <label class="field">
            <span class="field-label">{{ t('settings.styleDialog.prompt') }} <span class="required">*</span></span>
            <textarea v-model="styleForm.prompt" class="textarea" rows="3" :placeholder="t('settings.styleDialog.promptPlaceholder')"></textarea>
          </label>
          <label class="field">
            <span class="field-label">{{ t('settings.styleDialog.description') }}</span>
            <input v-model="styleForm.description" class="input" :placeholder="t('settings.styleDialog.descPlaceholder')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('settings.styleDialog.sort') }}</span>
            <input v-model.number="styleForm.sort_order" class="input" type="number" min="0" max="999" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="styleDialog = false">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn btn-primary">{{ t('common.save') }}</button>
        </div>
      </form>
    </div>
    <!-- 迁移确认（自建 dialog：ConfirmDialog 的删除语义/Enter 快捷键不合此处） -->
    <div v-if="migrateDialog" class="overlay" @click.self="!migrating && (migrateDialog = false)">
      <form class="dialog" @submit.prevent="startMigrate">
        <div class="dialog-head"><span class="dialog-title">{{ t('settings.migrate.title') }}</span></div>
        <div class="dialog-body">
          <div class="field">
            <span class="field-label">{{ t('settings.migrate.newDir') }}</span>
            <div class="input mono" style="word-break: break-all">{{ migrateTarget }}</div>
          </div>
          <div class="field">
            <span class="field-label">{{ t('settings.migrate.dataToMove') }}</span>
            <div class="field-hint">
              {{ t('settings.migrate.sizeNote', { size: formatBytes(storageInfo?.usage?.total || 0) }) }}<template v-if="migrateTargetFree != null">{{ t('settings.migrate.freeNote', { size: formatBytes(migrateTargetFree) }) }}</template>
            </div>
          </div>
          <label class="field" style="display:flex; align-items:center; gap:8px; cursor:pointer">
            <input v-model="migrateFiles" type="checkbox" :disabled="migrating" />
            <span class="field-label" style="margin:0">{{ t('settings.migrate.moveFiles') }}</span>
          </label>
          <p v-if="!migrateFiles" class="field-hint migrate-warn">{{ t('settings.migrate.emptyWarn') }}</p>
          <p class="field-hint">{{ t('settings.migrate.note') }}</p>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" :disabled="migrating" @click="migrateDialog = false">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn btn-primary" :disabled="migrating">
            <Loader2 v-if="migrating" :size="12" class="animate-spin" />
            {{ t('settings.migrate.start') }}
          </button>
        </div>
      </form>
    </div>
    <ConfirmDialog
      :open="!!styleToDelete"
      :title="t('settings.styleDelete.title')"
      :message="t('settings.styleDelete.message', { name: styleToDelete?.name })"
      :loading="deletingStyle"
      @confirm="confirmDelStyle"
      @cancel="styleToDelete = null"
    />
    <ConfirmDialog
      :open="!!skillToDelete"
      :title="t('settings.skillDelete.title')"
      :message="t('settings.skillDelete.message', { id: skillToDelete })"
      :loading="deletingSkill"
      @confirm="confirmDelSkill"
      @cancel="skillToDelete = null"
    />
  </div>
</template>

<script setup>
import { Plus, Pencil, Trash2, FileText, ChevronDown, Check, Loader2, Bot, Cpu, Sparkles, Palette, ExternalLink, Star, HardDrive, Database, RefreshCw, Download, Languages, SunMoon, X, BookOpen } from 'lucide-vue-next'
import BaseSelect from '~/components/BaseSelect.vue'
import StyleModelsPanel from '~/components/StyleModelsPanel.vue'
import ModelInstallerPanel from '~/components/ModelInstallerPanel.vue'
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { useI18n } from 'vue-i18n'
import { aiConfigAPI, promptAPI, skillsAPI, storageAPI, stylePresetAPI, settingsAPI, serverUpdateAPI } from '~/composables/useApi'
import { useDesktopBridge } from '~/composables/useDesktopBridge'
import { useMigrateState } from '~/composables/useMigrateState'
import { useTheme } from '~/composables/useTheme'
import { providerIconUrl } from '~/composables/useProviderIcon'
import { startTour, autoTour } from '~/composables/useTour'
import { confirmUnifiedLanguage } from '~/composables/useUnifiedLanguage'
import { getProviderGuide, getServiceUsage, PROMPT_TEMPLATE_PRESETS, SDWEBUI_PRESETS, FOOOCUS_PRESETS } from '~/composables/providerGuides'

const { t, locale } = useI18n()

const showBrandImage = ref(true)
const tab = ref('ai')
const baseTabs = computed(() => [
  { id: 'ai', label: t('settings.tabs.ai'), icon: Cpu },
  { id: 'general', label: t('settings.tabs.general'), icon: Languages },
  { id: 'styles', label: t('settings.tabs.styles'), icon: Palette },
  { id: 'agents', label: t('settings.tabs.agents'), icon: Bot },
  { id: 'storage', label: t('settings.tabs.storage'), icon: HardDrive },
  { id: 'about', label: t('settings.tabs.about'), icon: RefreshCw },
])

// ===== AI Service Configs =====
const cfgs = ref([])
const cfgDialog = ref(false)
const cfgEditId = ref(null)
const cfgTesting = ref(false)
const cfgTestResult = ref(null)
// aiask.me 一键配置：同一个 Key 写入文本、图片、视频（Grok）三类推荐配置
const AIASK_SITE_URL = 'https://aiask.me'
const aiaskApiKey = ref('')
const aiaskSaving = ref(false)
// 本地服务（ComfyUI / SD WebUI / Fooocus）专属参数存后端 settings JSON，接口上以顶层字段读写
const LOCAL_SETTING_FIELDS = ['max_concurrent', 'comfyui_workflow', 'comfyui_template', 'comfyui_fps', 'comfyui_steps', 'comfyui_cfg', 'comfyui_negative_prompt', 'prompt_template', 'image_base_size', 'image_steps', 'image_cfg_scale', 'image_sampler', 'image_negative_prompt', 'fooocus_performance', 'fooocus_styles']
// 布尔设置单独处理：自动绑定默认开；中文翻译默认值按服务类型（本地生图开、ComfyUI 视频关）
const EMPTY_CFG_FORM = { name: '', provider: '', api_key: '', base_url: '', models: [], service_type: 'text', priority: 0, temperature: '', ...Object.fromEntries(LOCAL_SETTING_FIELDS.map(k => [k, ''])), comfyui_auto_bind: true, free_vram_between: '', auto_restart_comfy: true, oom_lower_resolution: true, prompt_translate: true, style_models_enabled: false, style_models: {}, model_install: null, style_models_auto_download: false, download_prefer_mirror: false, civitai_token: '', hf_token: '' }
const cfgForm = reactive({ ...EMPTY_CFG_FORM })
const LOCAL_BASE_URLS = { comfyui: 'http://127.0.0.1:8188', sdwebui: 'http://127.0.0.1:7860', fooocus: 'http://127.0.0.1:8888' }
const FOOOCUS_PERFORMANCE = ['Speed', 'Quality', 'Extreme Speed', 'Lightning', 'Hyper-SD']
const isLocalForm = computed(() => !!LOCAL_BASE_URLS[cfgForm.provider])
const isComfyForm = computed(() => cfgForm.provider === 'comfyui' && ['image', 'video'].includes(cfgForm.service_type))
const isSdForm = computed(() => cfgForm.provider === 'sdwebui' && cfgForm.service_type === 'image')
const isFooocusForm = computed(() => cfgForm.provider === 'fooocus' && cfgForm.service_type === 'image')
// 基准尺寸 / 步数 / CFG：ComfyUI 生图（内置模板）与 SD WebUI 使用
const showLocalImageParams = computed(() => cfgForm.service_type === 'image' && ['comfyui', 'sdwebui'].includes(cfgForm.provider))
const isLocalMediaForm = computed(() => isComfyForm.value || isSdForm.value || isFooocusForm.value)

// ===== 配置说明（每个服务商 × 服务类型）=====
const cfgGuide = computed(() => cfgForm.provider ? getProviderGuide(locale.value, cfgForm.service_type, cfgForm.provider) : null)
const serviceUsage = computed(() => getServiceUsage(locale.value, cfgForm.service_type))

// ===== 提示词模板 =====
// 字面量 {{prompt}} 不能写进模板文本或 i18n 文案（会被插值），统一用常量传入
const PROMPT_PH = '{{prompt}}'
const promptTemplatePresets = computed(() => PROMPT_TEMPLATE_PRESETS.filter(p => p.for.includes(cfgForm.service_type === 'video' ? 'video' : 'image')))
const promptTemplatePreview = computed(() => {
  const sample = t('settings.cfg.local.samplePrompt')
  const tpl = String(cfgForm.prompt_template || '').trim()
  if (!tpl) return sample
  return /\{\{\s*prompt\s*\}\}/i.test(tpl) ? tpl.replace(/\{\{\s*prompt\s*\}\}/gi, sample) : `${sample}, ${tpl}`
})
/** 一键下载模型按当前表单（未保存的草稿）计算：风格覆盖、内置模板 / 自定义工作流 */
const installerPlanSettings = computed(() => ({
  style_models: cfgForm.style_models || {},
  comfyui_template: comfySource.value === 'builtin' ? cfgForm.comfyui_template || '' : '',
  comfyui_workflow: comfySource.value === 'custom' ? cfgForm.comfyui_workflow || '' : '',
}))
/** 后端存的风格覆盖表（对象或 JSON 字符串）→ 表单对象 */
function parseStyleModels(v) {
  if (!v) return {}
  if (typeof v === 'object') return JSON.parse(JSON.stringify(v))
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {} } catch { return {} }
}
function applySdPreset(p) {
  cfgForm.image_base_size = p.base
  cfgForm.image_steps = p.steps
  cfgForm.image_cfg_scale = p.cfg
  cfgForm.image_sampler = p.sampler
  if (p.prompt) cfgForm.prompt_template = p.prompt
  toast.success(t('settings.cfg.local.presetApplied', { name: p.label }))
}
function applyFooocusPreset(p) {
  cfgForm.fooocus_performance = p.performance === 'Speed' ? '' : p.performance
  cfgForm.fooocus_styles = p.styles
  toast.success(t('settings.cfg.local.presetApplied', { name: locale.value === 'zh' ? p.zh : p.en }))
}

// ===== ComfyUI：工作流来源 / 内置模板 / 检查绑定 =====
const comfySource = ref('builtin')
const comfyTemplateCache = reactive({ image: [], video: [] })
const comfyTemplates = computed(() => comfyTemplateCache[cfgForm.service_type === 'image' ? 'image' : 'video'] || [])
// 按显存档位设计的模板按模型系列分组（组内从小到大），其余模板放「其他模板」
const comfyVramGroups = computed(() => {
  const groups = []
  for (const tpl of comfyTemplates.value) {
    if (!tpl.vram) continue
    const family = tpl.vram_family || ''
    let g = groups.find(x => x.family === family)
    if (!g) groups.push(g = { family, list: [] })
    g.list.push(tpl)
  }
  for (const g of groups) g.list.sort((a, b) => a.vram - b.vram)
  return groups
})
const comfyOtherTemplates = computed(() => comfyTemplates.value.filter(tpl => !tpl.vram))
async function ensureComfyTemplates(kind) {
  if (comfyTemplateCache[kind]?.length) return
  try { comfyTemplateCache[kind] = await aiConfigAPI.comfyTemplates(kind) || [] } catch (e) { toastError(e) }
}
watch(() => [cfgDialog.value, cfgForm.provider, cfgForm.service_type], ([open, provider, type]) => {
  if (open && provider === 'comfyui' && (type === 'image' || type === 'video')) ensureComfyTemplates(type)
})
/** 当前生效的内置模板：显式选择 > 模型名等于模板 ID > 模型文件属于某模板 > 默认（与后端 resolveComfyTemplate 一致） */
const activeComfyTemplate = computed(() => {
  const list = comfyTemplates.value
  if (!list.length) return null
  const byId = id => list.find(x => x.id === String(id || '').trim().toLowerCase())
  if (cfgForm.comfyui_template && byId(cfgForm.comfyui_template)) return byId(cfgForm.comfyui_template)
  const model = cfgForm.models[0] || ''
  if (byId(model)) return byId(model)
  const files = model.split(/[|,，+]/).map(x => x.trim().toLowerCase()).filter(Boolean)
  const byFile = list.find(x => x.files.some(f => files.includes(f.file.toLowerCase())))
  if (byFile) return byFile
  if (cfgForm.service_type === 'image' && files.some(f => /flux/.test(f))) return byId(files.some(f => /schnell/.test(f)) ? 'flux1-schnell' : 'flux1-dev')
  return list[0]
})
function useTemplateAsModel() {
  const tpl = activeComfyTemplate.value
  if (!tpl) return
  cfgForm.comfyui_template = tpl.id
  cfgForm.models = [tpl.default_model, ...cfgForm.models.filter(m => m !== tpl.default_model)]
  if (cfgForm.service_type === 'image' && tpl.recommended?.baseSize && !cfgForm.image_base_size) cfgForm.image_base_size = tpl.recommended.baseSize
}
function copyTemplateToEditor() {
  const tpl = activeComfyTemplate.value
  if (!tpl) return
  if (cfgForm.comfyui_workflow.trim() && !window.confirm(t('settings.cfg.comfy.overwriteConfirm'))) return
  cfgForm.comfyui_workflow = JSON.stringify(tpl.workflow, null, 2)
  comfySource.value = 'custom'
}
const inspecting = ref(false)
const inspectResult = ref(null)
const inspectBindings = computed(() => inspectResult.value?.bindings || [])
function bindTargetLabel(target) {
  const m = String(target || '').match(/^reference_image_(\d+)$/)
  if (m) return t('settings.cfg.comfy.target.reference', { n: m[1] })
  const key = `settings.cfg.comfy.target.${target}`
  const label = t(key)
  return label === key ? target : label
}
async function inspectComfyWorkflow() {
  if (comfySource.value === 'custom' && cfgForm.comfyui_workflow.trim()) {
    try { JSON.parse(cfgForm.comfyui_workflow) } catch { toast.warning(t('settings.cfg.comfy.workflowInvalid')); return }
  }
  inspecting.value = true
  try {
    inspectResult.value = await aiConfigAPI.comfyInspect({
      service_type: cfgForm.service_type,
      workflow: comfySource.value === 'custom' ? cfgForm.comfyui_workflow : '',
      comfyui_template: cfgForm.comfyui_template,
      model: cfgForm.models[0] || '',
      comfyui_auto_bind: cfgForm.comfyui_auto_bind,
      comfyui_steps: cfgForm.comfyui_steps,
      comfyui_cfg: cfgForm.comfyui_cfg,
      image_steps: cfgForm.image_steps,
      image_cfg_scale: cfgForm.image_cfg_scale,
      base_url: cfgForm.base_url || LOCAL_BASE_URLS.comfyui,
      api_key: cfgForm.api_key,
    })
  } catch (e) {
    toastError(e)
  } finally {
    inspecting.value = false
  }
}
// ===== 读取本地服务里的模型 / 采样器 / 风格 =====
const localModelsLoading = ref(false)
const localModels = ref(null)
async function loadLocalModels() {
  localModelsLoading.value = true
  try {
    localModels.value = await aiConfigAPI.localModels({
      provider: cfgForm.provider,
      service_type: cfgForm.service_type,
      base_url: cfgForm.base_url || LOCAL_BASE_URLS[cfgForm.provider],
      api_key: cfgForm.api_key,
    })
  } catch (e) {
    toastError(e)
  } finally {
    localModelsLoading.value = false
  }
}
function pickLocalItem(group, item) {
  if (group === 'samplers') { cfgForm.image_sampler = item; toast.success(t('settings.cfg.local.pickedSampler', { name: item })); return }
  if (group === 'styles') {
    const list = String(cfgForm.fooocus_styles || '').split(/[,，]/).map(x => x.trim()).filter(Boolean)
    if (!list.includes(item)) list.push(item)
    cfgForm.fooocus_styles = list.join(', ')
    return
  }
  if (group === 'loras' || group === 'vae' || group === 'text_encoders') {
    navigator.clipboard?.writeText(item).catch(() => {})
    toast.info(t('settings.cfg.local.copiedName', { name: item }))
    return
  }
  // 模型类：加入「模型」列表并设为默认（14B 双模型可在列表里手动改成「高噪声|低噪声」）
  if (!cfgForm.models.includes(item)) cfgForm.models.unshift(item)
  else pinModelTop(cfgForm.models.indexOf(item))
  toast.success(t('settings.cfg.local.pickedModel', { name: item }))
}
// ComfyUI 工作流支持的占位符（与后端 comfyui-video.ts 保持一致）
const COMFY_PLACEHOLDERS = '{{prompt}} {{negative_prompt}} {{seed}} {{width}} {{height}} {{duration}} {{fps}} {{frames}} {{aspect_ratio}} {{resolution}} {{model}} {{image}} {{first_frame}} {{last_frame}} {{reference_image_1}} ... {{reference_image_9}}'
const COMFY_IMAGE_PLACEHOLDERS = '{{prompt}} {{negative_prompt}} {{seed}} {{width}} {{height}} {{steps}} {{cfg}} {{model}} {{aspect_ratio}} {{image}} {{reference_image_1}} ... {{reference_image_6}}'
// 模型标签编辑器：首位即默认模型；输入框支持回车添加、逗号/换行批量粘贴
const modelInput = ref('')
function addModel() {
  const names = modelInput.value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
  for (const n of names) if (!cfgForm.models.includes(n)) cfgForm.models.push(n)
  modelInput.value = ''
}
function onModelPaste(e) {
  const text = e.clipboardData?.getData('text') || ''
  if (!/[,，\n]/.test(text)) return // 单模型走默认粘贴
  e.preventDefault()
  for (const n of text.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)) {
    if (!cfgForm.models.includes(n)) cfgForm.models.push(n)
  }
}
function removeModel(i) { cfgForm.models.splice(i, 1) }
function pinModelTop(i) {
  if (i <= 0) return
  const [m] = cfgForm.models.splice(i, 1)
  cfgForm.models.unshift(m)
}
// 服务类型 label/desc 渲染时求值（语言切换即时生效），type 为逻辑值
const serviceTypes = computed(() => [
  { type: 'text', label: t('common.serviceType.text') },
  { type: 'image', label: t('common.serviceType.image') },
  { type: 'video', label: t('common.serviceType.video') },
])
const providers = ['aiask', 'xai', 'gemini', 'openai', 'claude', 'deepseek', 'qwen', 'volcengine', 'minimax', 'aliyun', 'veo', 'runway', 'comfyui', 'sdwebui', 'fooocus']
const providerSelectOptions = computed(() => providers.map(p => ({ label: p, value: p })))
const serviceMeta = computed(() => ({
  text: { label: t('common.serviceType.text'), desc: t('settings.ai.meta.text') },
  image: { label: t('common.serviceType.image'), desc: t('settings.ai.meta.image') },
  video: { label: t('common.serviceType.video'), desc: t('settings.ai.meta.video') },
}))
const providerPresets = {
  text: {
    aiask: { label: 'aiask.me', baseUrl: AIASK_SITE_URL, models: ['gpt-6-astra', 'gpt-5.5', 'deepseek-v4-pro'] },
    gemini: { label: 'Gemini 官方', baseUrl: 'https://generativelanguage.googleapis.com', models: ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'] },
    openai: { label: 'OpenAI 官方', baseUrl: 'https://api.openai.com', models: ['deepseek-v4-pro', 'gpt-5.6-terra'] },
    deepseek: { label: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] },
    // 通义千问 OpenAI 兼容模式；国际站用 https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    qwen: { label: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3-max', 'qwen-plus', 'qwen-flash'] },
    claude: { label: 'Claude（Anthropic）', baseUrl: 'https://api.anthropic.com', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'] },
    xai: { label: 'Grok（xAI）', baseUrl: 'https://api.x.ai', models: ['grok-4.7', 'grok-4.6', 'grok-4.5'] },
  },
  image: {
    aiask: { label: 'aiask.me', baseUrl: AIASK_SITE_URL, models: ['gpt-image-2', 'grok-imagine-image', 'gemini-3-pro-image'] },
    xai: { label: 'Grok 图片（xAI）', baseUrl: 'https://api.x.ai', models: ['grok-imagine-image-2.0', 'grok-imagine-image-quality', 'grok-imagine-image'] },
    // 本地生图：模型名填 checkpoint 文件名（ComfyUI 内置模板的 ckpt_name）；SD WebUI / Fooocus 填 default 沿用当前模型
    comfyui: { label: '本地 ComfyUI', baseUrl: 'http://127.0.0.1:8188', models: ['sd_xl_base_1.0.safetensors'] },
    sdwebui: { label: 'Stable Diffusion WebUI', baseUrl: 'http://127.0.0.1:7860', models: ['default'] },
    fooocus: { label: 'Fooocus（Fooocus-API）', baseUrl: 'http://127.0.0.1:8888', models: ['default'] },
    gemini: { label: 'Gemini 官方', baseUrl: 'https://generativelanguage.googleapis.com', models: ['gemini-3-pro-image', 'gemini-3.1-flash-image'] },
    openai: { label: 'OpenAI 官方', baseUrl: 'https://api.openai.com', models: ['gpt-image-2'] },
  },
  video: {
    aiask: { label: 'aiask.me Grok 视频', baseUrl: AIASK_SITE_URL, models: ['grok-imagine-video-1.5'] },
    // xAI 原生接口：直连官方填 https://api.x.ai；aiask.me 的 Grok 分组 Key 填 https://aiask.me
    xai: { label: 'Grok 视频（xAI 原生）', baseUrl: 'https://api.x.ai', models: ['grok-imagine-video-1.5', 'grok-imagine-video'] },
    veo: { label: 'Google Veo（Gemini API）', baseUrl: 'https://generativelanguage.googleapis.com', models: ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview'] },
    runway: { label: 'Runway', baseUrl: 'https://api.dev.runwayml.com', models: ['gen4.5', 'gen4_turbo', 'veo3.1', 'veo3.1_fast'] },
    comfyui: { label: '本地 ComfyUI', baseUrl: 'http://127.0.0.1:8188', models: ['wan2.2-ti2v-5b'] },
    aliyun: { label: '阿里云百炼 Wan 3.0', baseUrl: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com', models: ['wan3.0-video', 'wan3.0-video-prime'] },
    volcengine: { label: 'Seedance 2.0 官方', baseUrl: 'https://ark.cn-beijing.volces.com', models: ['doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-260128'] },
    minimax: { label: 'MiniMax H3 官方', baseUrl: 'https://api.minimaxi.com', models: ['MiniMax-H3'] },
  },
}
// 名称持久化进 DB，用固定英文名，不随界面语言漂移；写入后同类型下优先级最高即成默认
const aiaskQuickConfigs = [
  { service_type: 'text', provider: 'aiask', name: 'aiask.me Text', base_url: AIASK_SITE_URL, model: ['gpt-6-astra', 'gpt-5.5', 'deepseek-v4-pro'], priority: 100 },
  { service_type: 'image', provider: 'aiask', name: 'aiask.me Image', base_url: AIASK_SITE_URL, model: ['gpt-image-2', 'grok-imagine-image', 'gemini-3-pro-image'], priority: 100 },
  { service_type: 'video', provider: 'aiask', name: 'aiask.me Grok Video', base_url: AIASK_SITE_URL, model: ['grok-imagine-video-1.5'], priority: 100 },
]

function byType(t) { return cfgs.value.filter(c => c.service_type === t) }
function countActive(t) { return byType(t).filter(c => c.is_active).length }
function fmtModel(m) { return Array.isArray(m) ? m.join(', ') : m || '—' }
function presetsByType(type) {
  const group = providerPresets[type] || {}
  return Object.entries(group).map(([provider, preset]) => ({ provider, ...preset }))
}
function applyProviderPreset(type, provider) {
  const preset = providerPresets[type]?.[provider]
  if (!preset) return
  cfgForm.provider = provider
  cfgForm.base_url = preset.baseUrl
  cfgForm.models = [...preset.models]
  // 配置名持久化进 DB：用 provider 英文 + 服务类型英文标识拼，不随界面语言漂移
  cfgForm.name = `${preset.label}-${type}`
  if (!cfgEditId.value) cfgForm.prompt_translate = type !== 'video'
}

async function loadCfgs() { try { cfgs.value = await aiConfigAPI.list() } catch (e) { toastError(e) } }

// ===== 默认模型选择 =====
// 默认解析规则与工作台/后端一致：启用配置中优先级最高者的模型列表首位
function defaultModelOf(type) {
  const active = cfgs.value.filter(c => c.service_type === type && c.is_active)
  if (!active.length) return null
  const top = [...active].sort((a, b) => (b.priority || 0) - (a.priority || 0))[0]
  const first = Array.isArray(top.model) ? top.model[0] : null
  return first ? { configId: top.id, model: first } : null
}
function isDefaultModel(type, c, m) {
  const d = defaultModelOf(type)
  return !!d && d.configId === c.id && d.model === m
}
const defaultSaving = ref(false)
async function setDefaultModel(type, c, m) {
  if (defaultSaving.value || isDefaultModel(type, c, m)) return
  defaultSaving.value = true
  try {
    const models = [m, ...(Array.isArray(c.model) ? c.model : []).filter(x => x !== m)]
    const maxPriority = Math.max(0, ...cfgs.value.filter(x => x.service_type === type).map(x => x.priority || 0))
    const payload = { model: models }
    if ((c.priority || 0) < maxPriority) payload.priority = maxPriority + 1
    if (!c.is_active) payload.is_active = true // 停用配置无法成为默认,选择即启用
    await aiConfigAPI.update(c.id, payload)
    toast.success(t('settings.ai.defaultModelSwitched', { type: serviceMeta.value[type].label, model: m }))
    await loadCfgs()
  } catch (e) {
    toastError(e)
  } finally {
    defaultSaving.value = false
  }
}
async function toggleCfg(c) { await aiConfigAPI.update(c.id, { is_active: !c.is_active }); loadCfgs() }
async function delCfg(id) { await aiConfigAPI.del(id); toast.success(t('index.deleted')); loadCfgs() }
async function applyAiaskQuickConfig() {
  const apiKey = aiaskApiKey.value.trim()
  if (!apiKey) { toast.warning(t('settings.ai.apiKeyRequired')); return }
  aiaskSaving.value = true
  try {
    for (const preset of aiaskQuickConfigs) {
      const existing = cfgs.value.find(c => c.name === preset.name || (c.service_type === preset.service_type && c.provider === preset.provider && c.base_url === preset.base_url))
      // 同类型里优先级最高的启用配置即默认：写入后要成为默认，优先级需高于其它配置
      const others = cfgs.value.filter(c => c.service_type === preset.service_type && c.id !== existing?.id)
      const topPriority = Math.max(preset.priority, ...others.map(c => (c.priority || 0) + 1))
      if (existing) {
        // 已有配置只换 Key、启用并置顶：保留用户挑过的默认模型与模型列表
        const payload = { api_key: apiKey, is_active: true }
        if ((existing.priority || 0) < topPriority) payload.priority = topPriority
        await aiConfigAPI.update(existing.id, payload)
      } else {
        await aiConfigAPI.create({ ...preset, api_key: apiKey, priority: topPriority })
      }
    }
    toast.success(t('settings.ai.quickApplied'))
    aiaskApiKey.value = ''
    await loadCfgs()
  } catch (e) {
    toastError(e)
  } finally {
    aiaskSaving.value = false
  }
}
function startAddCfg(t) {
  cfgEditId.value = null
  cfgTestResult.value = null
  Object.assign(cfgForm, { ...EMPTY_CFG_FORM, models: [], service_type: t, prompt_translate: t !== 'video', style_models: {}, model_install: null })
  const firstPreset = presetsByType(t)[0]
  if (firstPreset) applyProviderPreset(t, firstPreset.provider)
  comfySource.value = 'builtin'
  inspectResult.value = null
  localModels.value = null
  cfgDialog.value = true
}
function startEditCfg(c) {
  cfgEditId.value = c.id
  cfgTestResult.value = null
  Object.assign(cfgForm, {
    name: c.name || '',
    provider: c.provider,
    api_key: c.api_key || '',
    base_url: c.base_url || '',
    models: Array.isArray(c.model) ? [...c.model] : String(c.model || '').split(',').map(s => s.trim()).filter(Boolean),
    service_type: c.service_type,
    priority: c.priority ?? 0,
    temperature: c.temperature ?? '',
    ...Object.fromEntries(LOCAL_SETTING_FIELDS.map(k => [k, c[k] ?? ''])),
    comfyui_workflow: formatWorkflow(c.comfyui_workflow),
    comfyui_auto_bind: c.comfyui_auto_bind !== false,
    free_vram_between: c.free_vram_between === true ? 'on' : c.free_vram_between === false ? 'off' : '',
    auto_restart_comfy: c.auto_restart_comfy !== false,
    oom_lower_resolution: c.oom_lower_resolution !== false,
    prompt_translate: typeof c.prompt_translate === 'boolean' ? c.prompt_translate : c.service_type !== 'video',
    style_models_enabled: c.style_models_enabled === true,
    style_models: parseStyleModels(c.style_models),
    model_install: c.model_install && typeof c.model_install === 'object' ? JSON.parse(JSON.stringify(c.model_install)) : null,
    style_models_auto_download: c.style_models_auto_download === true,
    download_prefer_mirror: c.download_prefer_mirror === true,
    civitai_token: c.civitai_token || '',
    hf_token: c.hf_token || '',
  })
  comfySource.value = c.comfyui_workflow ? 'custom' : 'builtin'
  inspectResult.value = null
  localModels.value = null
  cfgDialog.value = true
}
async function testCfgPayload(payload) {
  cfgTesting.value = true
  try {
    cfgTestResult.value = await aiConfigAPI.test(payload)
    if (cfgTestResult.value.reachable) toast.success(t('settings.cfg.reachable'))
    else toast.warning(t('settings.cfg.unreachable'))
  } catch (e) {
    toastError(e)
  } finally {
    cfgTesting.value = false
  }
}
async function testDraftCfg() {
  await testCfgPayload({
    service_type: cfgForm.service_type,
    provider: cfgForm.provider,
    api_key: cfgForm.api_key,
    base_url: cfgForm.base_url,
    model: [...cfgForm.models],
  })
}
async function testExistingCfg(c) {
  startEditCfg(c)
  await testCfgPayload({
    service_type: c.service_type,
    provider: c.provider,
    api_key: c.api_key || '',
    base_url: c.base_url || '',
    model: Array.isArray(c.model) ? c.model : [],
  })
}
/** 当前服务商用到的本地参数（空值发 null，后端据此删除该项） */
function localSettingsPayload() {
  const num = v => (v === '' || v === null || v === undefined ? null : Number(v))
  const text = v => String(v ?? '').trim()
  const imageParams = () => ({ image_base_size: num(cfgForm.image_base_size), image_steps: num(cfgForm.image_steps), image_cfg_scale: num(cfgForm.image_cfg_scale) })
  // 视觉风格 → 模型：开关 + 覆盖表（空表发空串，后端删除）
  const styleOverrides = Object.fromEntries(Object.entries(cfgForm.style_models || {})
    .map(([k, row]) => [k, Object.fromEntries(Object.entries(row || {}).map(([f, v]) => [f, String(v ?? '').trim()]).filter(([, v]) => v))])
    .filter(([, row]) => Object.keys(row).length))
  const promptParams = () => ({
    // 本地显卡排队：同时提交几个任务（空 = 1）
    max_concurrent: num(cfgForm.max_concurrent),
    prompt_template: text(cfgForm.prompt_template),
    prompt_translate: !!cfgForm.prompt_translate,
    style_models_enabled: !!cfgForm.style_models_enabled,
    style_models: Object.keys(styleOverrides).length ? styleOverrides : '',
    // 一键下载模型：安装位置 / 自动下载 / 镜像优先 / Token
    model_install: cfgForm.model_install && (cfgForm.model_install.root || cfgForm.model_install.mode === 'remote') ? cfgForm.model_install : '',
    style_models_auto_download: !!cfgForm.style_models_auto_download,
    download_prefer_mirror: !!cfgForm.download_prefer_mirror,
    civitai_token: text(cfgForm.civitai_token),
    hf_token: text(cfgForm.hf_token),
  })
  if (isComfyForm.value) {
    return {
      // 选内置模板时清空自定义工作流（后端据此改用模板）
      comfyui_workflow: comfySource.value === 'custom' ? text(cfgForm.comfyui_workflow) : '',
      comfyui_template: comfySource.value === 'builtin' ? text(cfgForm.comfyui_template) : '',
      comfyui_auto_bind: !!cfgForm.comfyui_auto_bind,
      auto_restart_comfy: !!cfgForm.auto_restart_comfy,
      comfyui_negative_prompt: text(cfgForm.comfyui_negative_prompt),
      ...promptParams(),
      ...(cfgForm.service_type === 'video'
        ? {
            comfyui_fps: num(cfgForm.comfyui_fps), comfyui_steps: num(cfgForm.comfyui_steps), comfyui_cfg: num(cfgForm.comfyui_cfg),
            free_vram_between: cfgForm.free_vram_between === 'on' ? true : cfgForm.free_vram_between === 'off' ? false : '',
            oom_lower_resolution: !!cfgForm.oom_lower_resolution,
          }
        : imageParams()),
    }
  }
  if (isSdForm.value) return { image_negative_prompt: text(cfgForm.image_negative_prompt), image_sampler: text(cfgForm.image_sampler), ...promptParams(), ...imageParams() }
  if (isFooocusForm.value) return { image_negative_prompt: text(cfgForm.image_negative_prompt), fooocus_performance: text(cfgForm.fooocus_performance), fooocus_styles: text(cfgForm.fooocus_styles), ...promptParams() }
  return {}
}
// ===== 配置弹窗：只能主动关闭；有未保存的修改时先确认 =====
const cfgSnapshot = ref('')
const cfgNudge = ref(false)
const cfgOutsideHint = ref(false)
let cfgNudgeTimer = null
let cfgHintTimer = null
function cfgFormState() {
  return JSON.stringify({ ...cfgForm, models: [...cfgForm.models], comfySource: comfySource.value })
}
// 打开弹窗后（预设、模板等初始化都完成）记下初始内容，用来判断是否有未保存的修改
watch(cfgDialog, (open) => {
  cfgOutsideHint.value = false
  if (open) nextTick(() => { cfgSnapshot.value = cfgFormState() })
})
const cfgDirty = computed(() => cfgDialog.value && !!cfgSnapshot.value && cfgFormState() !== cfgSnapshot.value)
function closeCfgDialog() {
  if (cfgDirty.value && !window.confirm(t('settings.cfg.discardConfirm'))) return
  cfgDialog.value = false
}
/** 误点遮罩：不关闭，弹窗轻微晃动并提示用右上角的关闭按钮 */
function nudgeCfgDialog() {
  cfgNudge.value = false
  clearTimeout(cfgNudgeTimer)
  requestAnimationFrame(() => { cfgNudge.value = true })
  cfgNudgeTimer = setTimeout(() => { cfgNudge.value = false }, 500)
  // 提示放在弹窗里（toast 会盖住右上角的关闭按钮）
  cfgOutsideHint.value = true
  clearTimeout(cfgHintTimer)
  cfgHintTimer = setTimeout(() => { cfgOutsideHint.value = false }, 3500)
}
// 填写过程中关闭 / 刷新页面也提醒
function onCfgBeforeUnload(e) {
  if (!cfgDirty.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onCfgBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onCfgBeforeUnload))

// 工作流以紧凑 JSON 存库，编辑时格式化展示
function formatWorkflow(raw) {
  if (!raw) return ''
  try { return JSON.stringify(typeof raw === 'string' ? JSON.parse(raw) : raw, null, 2) } catch { return String(raw) }
}
async function saveCfg() {
  if (!cfgForm.provider) { toast.warning(t('settings.cfg.providerRequired')); return }
  const models = [...cfgForm.models]
  const temperature = cfgForm.temperature === '' || cfgForm.temperature === null ? null : Number(cfgForm.temperature)
  if (temperature !== null && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    toast.warning(t('settings.cfg.tempInvalid')); return
  }
  // 本地服务专属字段：工作流 JSON 先在前端校验一次，后端还会校验是否为 API 格式
  const comfy = localSettingsPayload()
  if (comfy.comfyui_workflow) {
    try { JSON.parse(comfy.comfyui_workflow) } catch { toast.warning(t('settings.cfg.comfy.workflowInvalid')); return }
  }
  if (isComfyForm.value && comfySource.value === 'custom' && !comfy.comfyui_workflow) {
    toast.warning(t('settings.cfg.comfy.workflowEmpty')); return
  }
  try {
    if (cfgEditId.value) await aiConfigAPI.update(cfgEditId.value, { name: cfgForm.name, provider: cfgForm.provider, api_key: cfgForm.api_key, base_url: cfgForm.base_url, model: models, priority: cfgForm.priority, temperature, ...comfy })
    else await aiConfigAPI.create({ service_type: cfgForm.service_type, provider: cfgForm.provider, name: cfgForm.name || `${cfgForm.provider}-${cfgForm.service_type}`, api_key: cfgForm.api_key, base_url: cfgForm.base_url, model: models, priority: cfgForm.priority, temperature, ...comfy })
    cfgDialog.value = false; toast.success(t('common.saved')); loadCfgs()
  } catch (e) { toastError(e) }
}

// ===== Agent Configs =====
const agentCfgs = ref([])
const agentPane = ref('prompt')   // 右侧子 tab：prompt | skills
const agentSaving = ref(false)
const agentSaved = ref(null)
const agentForm = reactive({ system_prompt: '' })

const agentDefs = computed(() => [
  { type: 'script_rewriter', label: t('settings.agents.scriptRewriter'), icon: '📝' },
  { type: 'extractor', label: t('settings.agents.extractor'), icon: '🔍' },
  { type: 'storyboard_breaker', label: t('settings.agents.storyboardBreaker'), icon: '🎬' },
  { type: 'prompt_generator', label: t('settings.agents.promptGenerator'), icon: '🖼' },
])

function getAgentCfg(type) {
  return agentCfgs.value.find(a => a.agent_type === type)
}


async function loadAgents() {
  try { agentCfgs.value = await promptAPI.list() }
  catch (e) { toastError(e) }
}

async function loadAgentPrompt(type) {
  try {
    const cfg = await promptAPI.get(type, editLang.value)
    if (selectedAgent.value === type) {
      agentForm.system_prompt = cfg.system_prompt || ''
      agentPromptFallback.value = editLang.value !== 'zh' && !!cfg.is_default
    }
    agentSaved.value = null
  } catch (e) { toastError(e) }
}

async function resetAgentPrompt(type) {
  try {
    await promptAPI.reset(type, editLang.value)
    await loadAgents()
    const cfg = await promptAPI.get(type, editLang.value)
    agentForm.system_prompt = cfg.system_prompt || ''
    agentPromptFallback.value = editLang.value !== 'zh' && !!cfg.is_default
    toast.success(t('settings.agents.promptReset'))
  } catch (e) { toastError(e) }
}

async function saveAgentCfg(type) {
  agentSaving.value = true
  agentSaved.value = null
  try {
    await promptAPI.update(type, {
      name: agentDefs.value.find(a => a.type === type)?.label || type,
      system_prompt: agentForm.system_prompt,
    }, editLang.value)
    await loadAgents()
    agentPromptFallback.value = false
    agentSaved.value = type
    toast.success(t('settings.agents.saved', { agent: agentDefs.value.find(a => a.type === type)?.label }))
    setTimeout(() => { if (agentSaved.value === type) agentSaved.value = null }, 3000)
  } catch (e) {
    toastError(e)
  } finally {
    agentSaving.value = false
  }
}

// ===== Skills =====
const selectedAgent = ref('script_rewriter')
const allSkills = ref([])   // { id, name, description }[]
const editingSkill = ref(null)
const skillContent = ref('')
const skillSaving = ref(false)
const skillSaved = ref(null)
const addSkillDialog = ref(false)
const newSkillForm = reactive({ id: '', name: '', description: '' })

const selectedAgentType = computed(() => selectedAgent.value)
const selectedAgentLabel = computed(() => agentDefs.value.find(a => a.type === selectedAgent.value)?.label || '')
const selectedAgentIcon = computed(() => agentDefs.value.find(a => a.type === selectedAgent.value)?.icon || '')

// ===== 通用：AI 内容语言（全局设置，与界面语言相互独立） =====
const contentLanguage = ref('zh')
const contentLangOptions = [
  { value: 'zh', label: '中文', shortLabel: '中文' },
  { value: 'en', label: 'English', shortLabel: 'EN' },
  { value: 'ja', label: '日本語', shortLabel: '日本語' },
  { value: 'ko', label: '한국어', shortLabel: '한국어' },
  { value: 'vi', label: 'Tiếng Việt', shortLabel: 'VI' },
  { value: 'de', label: 'Deutsch', shortLabel: 'DE' },
  { value: 'fr', label: 'Français', shortLabel: 'FR' },
  { value: 'es', label: 'Español', shortLabel: 'ES' },
  { value: 'pt', label: 'Português', shortLabel: 'PT' },
]
// ===== Agent 配置：prompt/skill 编辑的语言版本（只读跟随内容语言） =====
const agentPromptFallback = ref(false)   // 当前语言无独立 prompt 文件，展示的是回退内容
const skillContentFallback = ref(false)  // 同上，skill 编辑器
const promptFileName = computed(() => `workspace/prompts/${selectedAgent.value}${editLang.value !== 'zh' ? `.${editLang.value}` : ''}.md`)
const skillFileName = computed(() => `SKILL${editLang.value !== 'zh' ? `.${editLang.value}` : ''}.md`)

// Agent 编辑语言 = 全局内容语言的只读镜像（改语言请到「通用」页）
const editLang = computed(() => contentLanguage.value)
const contentLangLabel = computed(() =>
  contentLangOptions.find(l => l.value === contentLanguage.value)?.label || contentLanguage.value)

// 内容语言变化时同步刷新 Agent 面板（提示词、Skill 列表与展开内容）
// 内容语言切换后整页刷新（setUnifiedLanguage），无需局部 watch 同步
// ===== 通用：外观主题（localStorage 持久化，即时生效） =====
const { themeMode, setThemeMode } = useTheme()
const themeOptions = computed(() => [
  { value: 'light', label: t('settings.general.appearanceLight') },
  { value: 'dark', label: t('settings.general.appearanceDark') },
  { value: 'system', label: t('settings.general.appearanceSystem') },
])

async function loadContentLanguage() {
  try {
    const lang = (await settingsAPI.contentLanguage())?.language || 'zh'
    contentLanguage.value = lang
    editLang.value = lang  // Agent 编辑器默认跟随内容语言
  } catch { /* 保持默认 */ }
}
async function setContentLanguage(lang) {
  if (contentLanguage.value === lang) return
  // UI 语言 = AI 内容语言：确认弹窗 → 统一切换 → 刷新（顶栏 LocaleSwitcher 同一入口）
  await confirmUnifiedLanguage(lang)
}
onMounted(loadContentLanguage)

// agent type 用下划线（script_rewriter），skill 目录按 Mastra 规范用连字符（script-rewriter）
const skillDirOf = (type) => type.replace(/_/g, '-')
const skillBelongsTo = (skillId, type) => {
  const dir = skillDirOf(type)
  return skillId === dir || skillId.startsWith(dir + '/')
}

function agentSkillCount(type) {
  return allSkills.value.filter(s => skillBelongsTo(s.id, type)).length
}

const currentSkills = computed(() =>
  allSkills.value.filter(s => skillBelongsTo(s.id, selectedAgent.value))
)

async function loadAllSkills() {
  try { allSkills.value = await skillsAPI.list(editLang.value) }
  catch (e) { toastError(e) }
}

async function selectAgent(type) {
  if (selectedAgent.value !== type) {
    selectedAgent.value = type
    editingSkill.value = null
  }
  await loadAgentPrompt(type)
}

function startAddSkill() {
  newSkillForm.id = ''
  newSkillForm.name = ''
  newSkillForm.description = ''
  addSkillDialog.value = true
}

async function confirmAddSkill() {
  if (!newSkillForm.id) return
  const skillId = `${skillDirOf(selectedAgent.value)}/${newSkillForm.id}`
  try {
    await skillsAPI.create({ id: skillId, name: newSkillForm.name, description: newSkillForm.description })
    addSkillDialog.value = false
    await loadAllSkills()
    toast.success(t('settings.skills.created'))
  } catch (e) {
    toastError(e)
  }
}

const skillToDelete = ref(null)
const deletingSkill = ref(false)

async function confirmDelSkill() {
  const id = skillToDelete.value
  if (!id) return
  try {
    deletingSkill.value = true
    await skillsAPI.del(id)
    if (editingSkill.value === id) editingSkill.value = null
    await loadAllSkills()
    skillToDelete.value = null
    toast.success(t('index.deleted'))
  } catch (e) {
    toastError(e)
  } finally {
    deletingSkill.value = false
  }
}

async function toggleSkillEdit(id) {
  if (editingSkill.value === id) { editingSkill.value = null; return }
  try {
    const res = await skillsAPI.get(id, editLang.value)
    skillContent.value = res.content
    skillContentFallback.value = editLang.value !== 'zh' && !!res.is_default
    skillSaved.value = null
    editingSkill.value = id
  } catch (e) { toastError(e) }
}

async function saveSkill(id) {
  skillSaving.value = true
  skillSaved.value = null
  try {
    await skillsAPI.update(id, skillContent.value, editLang.value)
    await loadAllSkills()
    skillContentFallback.value = false
    skillSaved.value = id
    toast.success(t('common.saved'))
    setTimeout(() => { if (skillSaved.value === id) skillSaved.value = null }, 3000)
  } catch (e) {
    toastError(e)
  } finally {
    skillSaving.value = false
  }
}

// ===== Style Presets =====
const stylePresets = ref([])
const styleDialog = ref(false)
const styleEditId = ref(null)
const styleForm = reactive({ name: '', value: '', prompt: '', description: '', sort_order: 0 })

async function loadStylePresets() {
  try { stylePresets.value = await stylePresetAPI.list(true) } catch (e) { toastError(e) }
}

async function toggleStyle(p) {
  try {
    await stylePresetAPI.update(p.id, { is_active: !p.is_active })
    loadStylePresets()
  } catch (e) { toastError(e) }
}

const styleToDelete = ref(null)
const deletingStyle = ref(false)

async function confirmDelStyle() {
  const p = styleToDelete.value
  if (!p) return
  try {
    deletingStyle.value = true
    await stylePresetAPI.del(p.id)
    styleToDelete.value = null
    toast.success(t('index.deleted'))
    loadStylePresets()
  } catch (e) {
    toastError(e)
  } finally {
    deletingStyle.value = false
  }
}

function startAddStyle() {
  styleEditId.value = null
  Object.assign(styleForm, {
    name: '', value: '', prompt: '', description: '',
    sort_order: (stylePresets.value.at(-1)?.sort_order ?? 0) + 1,
  })
  styleDialog.value = true
}

function startEditStyle(p) {
  styleEditId.value = p.id
  Object.assign(styleForm, {
    name: p.name,
    value: p.value,
    prompt: p.prompt,
    description: p.description || '',
    sort_order: p.sort_order ?? 0,
  })
  styleDialog.value = true
}

async function saveStyle() {
  if (!styleForm.name?.trim() || !styleForm.prompt?.trim() || (!styleEditId.value && !styleForm.value?.trim())) {
    toast.warning(t('settings.styleDialog.required'))
    return
  }
  try {
    if (styleEditId.value) {
      await stylePresetAPI.update(styleEditId.value, {
        name: styleForm.name,
        prompt: styleForm.prompt,
        description: styleForm.description,
        sort_order: styleForm.sort_order,
      })
    } else {
      await stylePresetAPI.create({ ...styleForm })
    }
    styleDialog.value = false
    toast.success(t('common.saved'))
    loadStylePresets()
  } catch (e) { toastError(e) }
}

onMounted(() => { loadCfgs(); loadAgents(); loadAllSkills(); loadAgentPrompt(selectedAgent.value); loadStylePresets() })

// ===== 应用内引导（设置页）：快捷配置 + 手动模板两步 =====
const SETTINGS_TOUR = [
  { element: '.quick-card', titleKey: 'tour.settings.quick.title', descKey: 'tour.settings.quick.desc', popoverSide: 'bottom' },
  { element: '.nav-item:has(.lucide-cpu), .nav-item:nth-of-type(1)', titleKey: 'tour.settings.nav.title', descKey: 'tour.settings.nav.desc', popoverSide: 'right' },
]
onMounted(() => setTimeout(() => autoTour('settings', SETTINGS_TOUR, t), 800))
function replaySettingsTour() { startTour('settings', SETTINGS_TOUR, t) }

// ===== 存储位置 =====
const desktopBridge = useDesktopBridge()
const { begin: beginMigrate, update: updateMigrate, end: endMigrate } = useMigrateState()

const storageInfo = ref(null)
const migrateDialog = ref(false)
const migrateTarget = ref('')
const migrateTargetFree = ref(null)
const migrateFiles = ref(true)
const migrating = ref(false)

const isDesktopMode = computed(() => storageInfo.value?.mode === 'desktop' && !!desktopBridge)

let usagePollTimer = null

function stopUsagePoll() {
  if (usagePollTimer) { clearInterval(usagePollTimer); usagePollTimer = null }
}

async function loadStorage() {
  try {
    storageInfo.value = await storageAPI.info()
    // 占用为空或统计已过期时 2s 轮询至新鲜（后端 stale-while-revalidate）
    stopUsagePoll()
    if (storageInfo.value?.usageStale || !storageInfo.value?.usage) {
      usagePollTimer = setInterval(async () => {
        try {
          storageInfo.value = await storageAPI.info()
          if (storageInfo.value?.usage && !storageInfo.value?.usageStale) stopUsagePoll()
        } catch { /* 轮询错误静默 */ }
      }, 2000)
    }
  } catch (e) { toastError(e, { fallback: 'settings.storage.loadFailed' }) }
}

watch(tab, (active) => {
  if (active === 'storage') loadStorage()
  else stopUsagePoll()
})

async function pickTarget() {
  if (!desktopBridge) return
  const res = await desktopBridge.pickDirectory()
  if (res.canceled) return
  if (!res.ok || !res.path) { toastError(res.error, { fallback: 'settings.migrate.pickFailed' }); return }
  migrateTarget.value = res.path
  migrateTargetFree.value = res.freeBytes ?? null
  migrateFiles.value = true
  migrateDialog.value = true
}

async function startMigrate() {
  if (!desktopBridge || !migrateTarget.value) return
  migrating.value = true
  beginMigrate()
  try {
    await desktopBridge.startMigration({ targetDir: migrateTarget.value, migrateFiles: migrateFiles.value })
    // 成功的完成提示与页面刷新由全局进度订阅（app.vue）处理
  } catch (e) {
    endMigrate()
    // Electron 的 invoke 错误带「Error invoking remote method …: Error: 」前缀，只留原因
    const reason = String(e?.message || e || '').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
    toastError(reason || e, { fallback: 'settings.migrate.failed' })
  } finally {
    migrating.value = false
    migrateDialog.value = false
    stopUsagePoll()
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

// ===== 应用内更新（桌面版走 Electron 桥；服务器/Docker 走后端 server-update 路由） =====
const updateState = ref(null)
const updateChecking = ref(false)
const updateDownloading = ref(false)
const updateProgress = ref(0)
const updateApplying = ref(false)
const serverUpdateMode = ref('manual') // 'watchtower' | 'manual'，仅服务器模式有意义

async function refreshUpdateState() {
  try {
    if (desktopBridge) {
      updateState.value = await desktopBridge.getUpdateState()
    } else {
      const s = await serverUpdateAPI.state()
      serverUpdateMode.value = s.updateMode || 'manual'
      updateState.value = s
    }
  } catch { /* 静默 */ }
}

async function checkUpdate() {
  updateChecking.value = true
  try {
    if (desktopBridge) {
      updateState.value = await desktopBridge.checkUpdate()
    } else {
      const s = await serverUpdateAPI.check()
      serverUpdateMode.value = s.updateMode || 'manual'
      updateState.value = s
    }
    if (updateState.value?.status === 'up-to-date') toast.success(t('settings.about.upToDate'))
  } catch (e) {
    toastError(e, { fallback: 'settings.about.checkFailedToast' })
    refreshUpdateState()
  } finally { updateChecking.value = false }
}

async function downloadUpdate() {
  if (!desktopBridge) return
  updateDownloading.value = true
  updateProgress.value = 0
  const unProgress = desktopBridge.onUpdateProgress((p) => { updateProgress.value = p })
  try {
    updateState.value = await desktopBridge.downloadUpdate()
    toast.success(t('settings.about.downloadDone'))
  } catch (e) {
    toastError(e, { fallback: 'settings.about.downloadFailed' })
    refreshUpdateState()
  } finally {
    unProgress()
    updateDownloading.value = false
  }
}

async function applyUpdate() {
  updateApplying.value = true
  try {
    if (desktopBridge) {
      await desktopBridge.applyUpdate()
      // 成功路径：应用退出并由更新后的版本接管，不会走到这里
    } else {
      await serverUpdateAPI.apply()
      // Watchtower 异步拉镜像重建容器，本进程随后被替换
      toast.success(t('settings.about.serverApplyStarted'), { duration: 8000 })
      updateApplying.value = false
    }
  } catch (e) {
    updateApplying.value = false
    toastError(e, { fallback: desktopBridge ? 'settings.about.installFailed' : 'settings.about.serverApplyFailed' })
    refreshUpdateState()  // 桌面端 apply 失败会把具体原因写进 updateState.error，刷新显示在错误行
  }
}

watch(tab, (t) => {
  if (t === 'about') refreshUpdateState()
  // 进入 Agent 页总是按当前内容语言重载（幂等）：兜住「先切语言、后进 Agent」的时序
  if (t === 'agents') {
    loadAgentPrompt(selectedAgent.value)
    loadAllSkills()
  }
})

onBeforeUnmount(stopUsagePoll)
</script>

<style scoped>
.settings-page { display: flex; flex-direction: column; height: 100%; background: var(--bg-base); }

.settings-layout { display: flex; flex: 1; min-height: 0; }

.settings-nav {
  width: 220px; flex-shrink: 0; padding: 16px 12px 16px; border-right: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 14px;
}
.nav-group { display: flex; flex-direction: column; gap: 2px; }
.nav-group-label {
  font-size: 11px; font-weight: 650; color: var(--text-3);
  letter-spacing: 0.06em; padding: 8px 12px 4px;
}
.nav-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; font-size: 13px; font-weight: 550;
  border: none; border-radius: var(--radius); background: transparent; color: var(--text-1);
  cursor: pointer; transition: all 0.16s var(--ease-out); text-align: left; width: 100%;
}
.nav-item:hover { background: var(--bg-hover); color: var(--text-0); }
.nav-item.active { background: var(--accent-bg); color: var(--accent-text); font-weight: 650; }
.nav-item:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }

.settings-content { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.settings-scroll { height: 100%; overflow-y: auto; padding: 20px 28px 48px; animation: fadeUp 0.3s var(--ease-out); }
/* 各分组卡片之间的间距（通用页内容语言/外观等） */
.settings-scroll > .card + .card { margin-top: 14px; }
/* 宽屏下内容列限宽居中，两侧留出呼吸空间 */
.settings-scroll > * { max-width: 1080px; margin-left: auto; margin-right: auto; }
.settings-head { margin-bottom: 20px; }
.settings-title { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.settings-desc { font-size: 13px; color: var(--text-2); margin-top: 6px; }

/* aiask.me 快捷配置 */
.quick-card {
  padding: 20px;
  margin-bottom: 16px;
  border: 1.5px solid var(--accent);
}
.quick-card:hover { border-color: var(--accent); }
.quick-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.setup-title { font-size: 15px; font-weight: 700; color: var(--text-0); }
.setup-desc { font-size: 12.5px; color: var(--text-2); margin-bottom: 14px; }
.quick-site-link {
  display: inline-flex; align-items: center; gap: 3px;
  margin-left: 6px;
  color: var(--accent); text-decoration: none;
  font-weight: 600; white-space: nowrap;
}
.quick-site-link:hover { text-decoration: underline; }
.quick-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}
.quick-models {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.hqm-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 11px;
  line-height: 1.6;
}
.hqm-label {
  flex-shrink: 0;
  width: 28px;
  font-weight: 600;
  color: var(--text-2);
}
.hqm-provider {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.hqm-provider-icon { width: 11px; height: 11px; object-fit: contain; border-radius: 2px; }
.hqm-models {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--text-3);
}
.hqm-model.is-default { color: var(--text-1); font-weight: 600; }
.hqm-model em {
  font-style: normal;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-text);
  background: var(--accent-bg);
}

/* 模型标签编辑器（配置弹窗） */
.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.model-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--bg-2);
  cursor: pointer;
  user-select: none;
  transition: border-color .15s, color .15s;
}
.model-chip:hover { border-color: var(--accent); color: var(--text-1); }
.model-chip.is-default { color: var(--text-1); font-weight: 600; border-color: var(--accent); }
.model-chip em {
  font-style: normal;
  padding: 0 5px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-text);
  background: var(--accent-bg);
}
.model-chip-x {
  display: inline-flex;
  align-items: center;
  padding: 1px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.model-chip-x:hover { color: var(--error); background: var(--bg-3); }
.model-add-row { display: flex; gap: 8px; }
.model-add-row .input { flex: 1; }

/* 手动模板 */
.setup-panel { padding: 18px 20px; margin-bottom: 16px; }
.setup-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.setup-panel-head.compact { margin-bottom: 12px; }
.template-row { display: flex; flex-wrap: wrap; gap: 8px; }
.template-type-chip {
  min-height: var(--button-height-sm);
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--button-bg);
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: all 0.16s var(--ease-out);
}
.template-type-chip:hover { background: var(--button-bg-hover); color: var(--text-0); }
.template-type-chip:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }

/* ===== 内容语言选择器（通用 tab） ===== */
.lang-picker { display: flex; gap: 2px; padding: 3px; border-radius: var(--radius-pill); background: var(--overlay-track); }
/* 九种语言放不下一行：允许换行，圆角改小以免换行后成椭圆 */
.lang-picker.lang-picker-wrap { flex-wrap: wrap; justify-content: flex-end; max-width: 440px; border-radius: 14px; }
.lang-option {
  min-height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: all 0.16s var(--ease-out);
  white-space: nowrap;
}
.lang-option:hover { color: var(--text-0); }
.lang-option.on { background: var(--seg-active-bg); color: var(--text-0); box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
.lang-option:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }

/* 按服务类型分组的配置卡 */
.sections { display: flex; flex-direction: column; gap: 16px; }
.svc-group { overflow: hidden; }
.svc-group-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}
.svc-group-heading { min-width: 0; }
.svc-group-title { font-size: 14px; font-weight: 700; color: var(--text-0); }
.svc-group-sub { font-size: 11.5px; color: var(--text-3); margin-top: 2px; }
.config-row { display: flex; align-items: center; gap: 12px; padding: 12px 20px; }
.config-row + .config-row { border-top: 1px solid var(--border); }
.provider-badge {
  width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 14px; color: var(--on-accent);
  background: var(--accent);
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
}
.provider-badge[data-provider="openai"] { background: #10a37f; }
.provider-badge[data-provider="gemini"] { background: #4285f4; }
.provider-badge[data-provider="volcengine"] { background: #ff5c39; }
.provider-badge[data-provider="comfyui"] { background: #5b5bd6; }
.provider-badge[data-provider="sdwebui"] { background: #e8622a; }
.provider-badge[data-provider="fooocus"] { background: #2b8a6e; }
.provider-badge[data-provider="runway"] { background: #1f1f1f; }
/* 有厂商图标时用中性底，彩色图标直接展示 */
.provider-badge.has-icon { background: var(--bg-2); }
.provider-badge-icon { width: 20px; height: 20px; object-fit: contain; }
.config-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.config-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.config-name { font-size: 13.5px; font-weight: 650; color: var(--text-0); }
.config-sub { font-size: 11.5px; color: var(--text-3); }
.config-models { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0; }
.cfg-model-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.cfg-model-chip:hover { border-color: var(--accent); color: var(--accent); }
.cfg-model-chip.is-default {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
  cursor: default;
}
.cfg-model-star { fill: currentColor; }
.config-empty { font-size: 12px; color: var(--text-3); padding: 14px 20px; }
.config-switch { display: inline-flex; flex-shrink: 0; cursor: pointer; }
.config-switch input:focus-visible + .switch { box-shadow: 0 0 0 3.5px var(--button-focus); }
.btn-icon.btn-sm { width: 30px; min-width: 30px; height: 30px; min-height: 30px; }

/* Agent */
.agent-card { overflow: hidden; }
.agent-type-badge {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--accent-bg); color: var(--accent-text);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0;
}
.agent-card-body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
/* tab 头在上，body 不再需要顶边框（头自带 border-bottom） */
.agent-card-foot { display: flex; align-items: center; gap: 8px; padding-top: 4px; }

/* Agent 右侧子 tab（System Prompt / Skills）：作为卡片头，与卡片同宽，不再单独悬浮 */
.agent-pane-tabs {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}
.agent-pane-tabs-wrap .agent-pane-tabs { border-bottom: 1px solid var(--border); }
.agent-pane-tabs-wrap { padding: 0; margin-bottom: 14px; overflow: hidden; }
.agent-pane-tabs-nav {
  display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 3px;
  background: var(--bg-1); border: 1px solid var(--border); border-radius: 10px;
}
.agent-pane-tab {
  padding: 5px 18px; border: none; border-radius: 7px;
  background: transparent; color: var(--text-2);
  font: 600 12px var(--font-body); cursor: pointer;
  white-space: nowrap; text-align: center;
  transition: background 0.15s, color 0.15s;
}
.agent-pane-tab:hover { color: var(--text-0); }
.agent-pane-tab.active { background: var(--accent-bg); color: var(--accent-text); }

/* Agent 编辑语言跟随提示（卡片头右侧只读说明，切换请到「通用」页） */
.agent-lang-follow { font-size: 11px; }

/* 「跟随中文」回退提示 */
.agent-fallback-tag {
  margin-left: 6px;
  background: var(--bg-2); color: var(--text-3);
  font-size: 10px; font-weight: 500;
}

/* 编辑器尽量占满剩余视口高度，仍可手动拖拽 */
.agent-prompt-input { min-height: max(320px, calc(100vh - 340px)); resize: vertical; }
.skill-content-input { min-height: max(300px, calc(100vh - 420px)); resize: vertical; }

/* Skills 布局 */
.skills-layout { display: flex; height: 100%; overflow: hidden; }
.skills-agent-list {
  width: 210px; flex-shrink: 0; border-right: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 4px;
  overflow-y: auto; padding: 20px 10px 16px;  /* 顶 padding 与右侧标题行起点对齐 */
}
.skills-agent-title {
  font-size: 11px; font-weight: 650; letter-spacing: 0.06em;
  color: var(--text-3); padding: 8px 10px 4px;
}
.skills-agent-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; font-size: 13px; font-weight: 550; cursor: pointer;
  border: none; border-radius: var(--radius); background: transparent; color: var(--text-1);
  transition: all 0.16s var(--ease-out); width: 100%; text-align: left;
}
.skills-agent-item:hover { background: var(--bg-hover); color: var(--text-0); }
.skills-agent-item.active { background: var(--accent-bg); color: var(--accent-text); font-weight: 650; }
.skills-agent-item:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }
.skills-agent-item .agent-type-badge { width: 26px; height: 26px; border-radius: 8px; font-size: 13px; }
.skills-agent-label { flex: 1; min-width: 0; }
.skill-count-badge {
  font-size: 10px; font-weight: 700; font-family: var(--font-mono);
  background: var(--bg-active); color: var(--text-2);
  padding: 1px 6px; border-radius: 99px;
}
.skills-agent-item.active .skill-count-badge { background: var(--accent-bg); color: var(--accent-text); }
.skills-main { flex: 1; min-width: 0; }
.skills-head {
  display: flex;
  align-items: flex-start;   /* 以标题块顶部为基线，徽章/按钮对齐标题第一行 */
  gap: 12px;
}
.skills-head .settings-title { line-height: 26px; }
.skills-head .btn { margin-top: -2px; }  /* 视觉上与标题第一行居中（按钮比标题行高） */
.skills-head-badge { width: 32px; height: 32px; font-size: 16px; }
.skills-head-copy { min-width: 0; }
.skills-empty { padding: 48px 24px; text-align: center; }
.skills-empty-icon {
  width: 56px; height: 56px; border-radius: 16px; margin: 0 auto 12px;
  background: var(--accent-bg); color: var(--accent-text);
  display: flex; align-items: center; justify-content: center;
}
.skills-empty-title { font-size: 14px; font-weight: 650; color: var(--text-0); }
.skills-empty-desc { font-size: 12px; color: var(--text-3); margin-top: 4px; }

/* Skill */
.skill-list { display: flex; flex-direction: column; gap: 10px; }
.skill-card { overflow: hidden; }
.skill-card-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; transition: background 0.15s; }
.skill-card-head:hover { background: var(--bg-hover); }
.skill-card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border); }
.skill-card-foot { display: flex; align-items: center; gap: 8px; }

/* Shared */
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 12px; font-weight: 550; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.required { color: var(--error); }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* Dialogs */
.config-dialog { width: min(720px, calc(100vw - 40px)); }
.config-dialog-body { display: flex; flex-direction: column; gap: 14px; }
.skill-dialog { width: 440px; }
.skill-dialog-body { display: flex; flex-direction: column; gap: 12px; }
.dialog-sub { margin-top: 4px; font-size: 12px; color: var(--text-2); }
.test-draft-btn { margin-right: auto; }
.preset-picker { display: flex; flex-wrap: wrap; gap: 8px; }
.preset-pill {
  min-height: var(--button-height-sm);
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--button-bg);
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: all 0.16s var(--ease-out);
}
.preset-pill:hover { background: var(--button-bg-hover); color: var(--text-0); }
.preset-pill:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }
/* ComfyUI 工作流配置 */
.comfy-workflow-input { min-height: 160px; font-size: 11.5px; line-height: 1.5; resize: vertical; }
.comfy-placeholder-list { overflow-wrap: anywhere; }
.comfy-row { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; }
.local-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.test-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  border: 1px solid var(--border);
  background: var(--bg-0);
}
.test-result.ok { border-color: var(--success); background: var(--success-bg); }
.test-result.bad { border-color: var(--error); background: var(--error-bg); }
.test-result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-1);
}
.test-result-url,
.test-result-diag { font-size: 11.5px; color: var(--text-2); margin-top: 4px; }
.test-result-preview {
  font-size: 11px;
  color: var(--text-2);
  word-break: break-all;
}

/* 存储位置 */
.storage-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.migrate-warn {
  color: var(--error);
}
.update-bar {
  width: 220px;
  height: 5px;
  border-radius: 3px;
  background: var(--overlay-track);
  overflow: hidden;
  margin-top: 6px;
}
.update-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 0.2s ease;
}

/* 配置说明 */
.cfg-guide { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-0); }
.cfg-guide-summary { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; list-style: none; color: var(--accent); }
.cfg-guide-summary::-webkit-details-marker { display: none; }
.cfg-guide-title { font-size: 12.5px; font-weight: 650; flex-shrink: 0; }
.cfg-guide-sub { font-size: 12px; color: var(--text-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfg-guide[open] .cfg-guide-sub { white-space: normal; }
.cfg-guide[open] .cfg-guide-summary { align-items: flex-start; flex-wrap: wrap; }
.cfg-guide[open] .cfg-guide-sub { flex-basis: 100%; }
.cfg-guide-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text-1); line-height: 1.6; }
.cfg-guide-usage { margin: 0; color: var(--text-2); }
.cfg-guide-section { font-size: 11.5px; font-weight: 650; color: var(--text-0); margin-top: 4px; }
.cfg-guide-steps, .cfg-guide-tips { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.cfg-guide-tips { color: var(--text-2); }
.cfg-guide-fields { border-collapse: collapse; width: 100%; }
.cfg-guide-fields th, .cfg-guide-fields td { text-align: left; vertical-align: top; padding: 4px 8px; border-top: 1px solid var(--border); font-size: 11.5px; }
.cfg-guide-fields th { width: 96px; color: var(--text-2); font-weight: 600; white-space: nowrap; }
.cfg-guide-links { display: flex; flex-wrap: wrap; gap: 12px; }
.cfg-guide-links a { color: var(--accent); text-decoration: none; font-size: 12px; }
.cfg-guide-links a:hover { text-decoration: underline; }

/* 本地服务：来源切换 / 模板卡片 / 勾选项 */
.seg-switch { display: inline-flex; padding: 3px; gap: 3px; border-radius: var(--radius-pill); background: var(--button-bg); align-self: flex-start; }
.seg-btn { border: none; background: transparent; color: var(--text-2); font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: var(--radius-pill); cursor: pointer; }
.seg-btn.active { background: var(--bg-1); color: var(--text-0); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.tpl-card { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; background: var(--bg-0); }
.tpl-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; }
.tpl-card-desc { margin: 0; font-size: 12px; color: var(--text-2); line-height: 1.6; }
.tpl-files { display: flex; flex-direction: column; gap: 4px; }
.tpl-files-title { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.tpl-file { display: flex; align-items: baseline; gap: 10px; font-size: 11px; }
.tpl-file-path { color: var(--text-2); overflow-wrap: anywhere; min-width: 0; }
.tpl-file-path b { color: var(--text-0); font-weight: 600; }
.tpl-file-link { flex-shrink: 0; color: var(--accent); text-decoration: none; }
.tpl-card-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.check-row { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--text-1); cursor: pointer; }
.check-row input { margin-top: 2px; accent-color: var(--accent); }
.check-row > span { display: flex; flex-direction: column; gap: 2px; }
.preset-pill.is-on { background: var(--accent-bg); color: var(--accent-text, var(--accent)); }
.prompt-preview { overflow-wrap: anywhere; }
.local-tools { display: flex; flex-wrap: wrap; gap: 8px; }

/* 检查工作流 / 本机模型 */
.inspect-panel { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--bg-0); }
.inspect-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; flex-wrap: wrap; }
.inspect-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.inspect-table th, .inspect-table td { text-align: left; padding: 5px 6px; border-top: 1px solid var(--border); vertical-align: top; }
.inspect-table th { color: var(--text-2); font-weight: 600; border-top: none; }
.inspect-table .tag { font-size: 10.5px; }
.bind-auto { background: var(--accent-bg); color: var(--accent-text, var(--accent)); }
.bind-placeholder { background: var(--success-bg); color: var(--success); }
.bind-override { background: var(--warning-bg, rgba(240, 160, 0, 0.12)); color: var(--warning, #b7791f); }
.inspect-warn { font-size: 11.5px; padding: 6px 8px; border-radius: 8px; background: var(--bg-1); color: var(--text-1); display: flex; flex-direction: column; gap: 2px; }
.inspect-warn.is-error { background: var(--error-bg); color: var(--error); }
.inspect-warn.is-ok { background: var(--success-bg); color: var(--success); }
.inspect-warnings { margin: 0; padding-left: 18px; font-size: 11.5px; color: var(--text-2); display: flex; flex-direction: column; gap: 3px; }
.model-group { display: flex; flex-direction: column; gap: 5px; }
.model-group-title { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.model-pick { cursor: pointer; border: none; font: inherit; }

/* 配置弹窗：醒目的关闭按钮 + 误点遮罩时的晃动提示 */
.dialog-close-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  height: 34px;
  padding: 0 12px 0 9px;
  border: 1.5px solid var(--error, #e5484d);
  border-radius: var(--radius-pill);
  background: var(--error-bg, rgba(229, 72, 77, 0.1));
  color: var(--error, #e5484d);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.15s;
}
.dialog-close-btn:hover { background: var(--error, #e5484d); color: #fff; }
.dialog-close-btn:active { transform: scale(0.96); }
.dialog-close-btn:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }
.config-dialog.is-nudged { animation: cfg-nudge 0.42s ease; }
.config-dialog.is-nudged .dialog-close-btn { background: var(--error, #e5484d); color: #fff; }
@keyframes cfg-nudge {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-7px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(2px); }
}
.cfg-outside-hint {
  padding: 8px var(--sp-6);
  font-size: 12px;
  font-weight: 600;
  color: var(--error, #e5484d);
  background: var(--error-bg, rgba(229, 72, 77, 0.1));
  border-bottom: 1px solid var(--border);
  animation: scaleIn 0.18s var(--ease-out);
}
.queue-row { display: flex; flex-wrap: wrap; gap: 10px 16px; }
.queue-item { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-1); }
.queue-item .input { width: auto; min-width: 120px; }
.queue-restart { margin-top: 8px; }
</style>
