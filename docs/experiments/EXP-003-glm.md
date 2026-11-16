# EXP-003 原始数据 · GLM 路由验证（2026-11-16）

## 迭代 1：patch 缺 id（失败形态，有诊断价值）

```
dsh: [/app/dsh-glm-patch.yml] patch: id is required for non-insert patches
```
→ 结论：pi-ai 插件不在默认树，插入行必须带 `id`。

## 迭代 2：未替换默认模型路由（失败形态）

```
dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official";
store DEEPSEEK_API_KEY through the credentials service … or export DEEPSEEK_API_KEY
```
→ 结论：headless 默认 `agent-default-model: {provider: deepseek-official, model: deepseek-flash}`；只挂 pi-ai 路由不够，必须同时替换该行。

## 迭代 3：全链成功（关键输出摘录）

```
dsh: reasoning:
The user wants me to create hello.txt in the current directory with content "ok"…
The write tool is the right choice here. Current working directory is /tmp/ws…
任务完成
--- hello.txt ---
ok
```

## 配置契约（最终版，docker/dsh-glm-patch.yml）

- 插入行 `id: llm-pi-ai` → `providers.glm: {api: openai-completions, baseURL: https://open.bigmodel.cn/api/paas/v4, apiKeyEnv: GLM_API_KEY, models: [{id: glm-5.3-flash, contextWindow: 128000}]}`
- 替换行 `id: agent-default-model` → `{provider: glm, model: glm-5.3-flash}`
