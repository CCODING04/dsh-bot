# EXP-010 · 拦截审计日志基建与飞轮当日闭环（2026-11-16）

**假设**：持续记录拦截/逃逸违规数据能把"围栏有效"从口头判断变成可审计指标（prove-it-works 应用于围栏自身；Lauren "Loops You Can Trust"）。

**方法**（gate-telemetry-plan 九步清单）：gate-ledger.mjs（脱敏 record/recordSync）→ L1/L3 双层接线 → gitignore → selftest 回归样本集（18 样本）→ stats 聚合（含 L2 gh api 只读聚合 + 四条口径页脚）→ 滚动摘要模板 → escape 回填 → 本存档。

**数据**：
- 验收：真实坏消息拦截落账（context 脱敏 ✓）；guard-bash 阻断落账（L3·npm-global）；selftest 18/18 且 7 条新事件全 selftest 类（口径规则 3 生效）；conflict-marker 新规则坏样本实测拦截。
- 上线首日生产计数：拦截 7（加权 11）+ escape 3（回填 GAP-001/002/003）；已发现口径拦截率 7/10=70%。
- **飞轮当日闭环（本实验的核心证据）**：实施过程中 rebase 冲突标记随坏合并穿过门禁（GAP-003，whyMissed=规则缺失）→ 当场转化为新规则 conflict-marker（检查 6）+ selftest 覆盖 → 从逃逸违规到防线生效 <1 小时。

**结论**：假设成立且已被自身实施过程验证。开发中的两个工程 bug（appendFile callback 版误用、selftest 基线时序）由验收回归样本集当场抓住——审计日志系统自证。局限：pre-commit/ci 类样本依赖真实 git 状态，留在 L2 CI 与手册验收（selftest 文件头已诚实标注）。
