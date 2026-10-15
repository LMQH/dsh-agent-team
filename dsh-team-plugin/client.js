/*
 * 本文件由 _tools/build-client.js 生成 —— 不要手改，改生成器再重跑 `node _tools/build-client.js`。
 * 设计契约见 CONSTITUTION.md（20 条），本文件头只复述与产物直接相关的几条。
 *
 * 生成方式：以官方客户端 bundle 为**外壳**（完整样式表、面板、portal、
 * useAnchoredPosition 定位、悬停展开、Esc 关闭、aria/role、中英文字典全部原样保留），
 * 只做三层改动：
 *
 *   A. 让位层（C1，机制=同槽位遮蔽）——slot id 与 order 与官方相同（agent-team / -20），
 *      但 priority = 100 高于官方默认 0。DSH 的 list 槽每个格子只渲染
 *      (priority ?? 0) 最小的那一条，于是：
 *        官方启用 → 官方那条胜出，本插件被自动遮蔽，不渲染任何东西；
 *        官方关闭 → 本插件成为唯一胜出者，自动接管它原来的位置。
 *      注册外包 try/catch：万一官方将来用同一个 priority 占位，register 抛错会被兜成
 *      「让位」而不是让整个 GUI 停在 "Failed to load plugins"。
 *
 *   B. 身份层（C3）——locale ns dsh-team-workflow / CSS 前缀 _twf_ /
 *      模块 id @local/dsh-team-workflow 一律自有。这三项沿用官方会让第二个 apply 抛错。
 *
 *   C. 内容层——数据来源换成 roles.json 内联的 10 个角色
 *      （指纹 2d662bddae7613bf），与 agentTeam 投影的真实成员按「成员名 = 角色 id」对齐，
 *      从而显示真实运行状态；角色行只展示五项（状态点 / 中文名 / 角色 id Tag / 状态词 / 职责，C5.1），
 *      悬停提示固定为官方那句「打开成员会话」，可点击进入该成员的会话详情（C7，官方同一入口）；
 *      官方面板的 tasks / failure 原样透传（C20.4）；产物 / 边界 / 能力 / 悬空技能改挂
 *      插件管理页的详情区块 plugins.detail.section（C20.2）。
 *
 * 落盘前硬断言（C13）：官方 CSS 前缀与官方包名 0 处；官方 slot id 恰好 1 处
 * （只能出现在 SHADOW_PRIORITY 旁边那个只读常量里）；自有坐标齐全。
 */
window.__ModuleLoader__.load({
	id: "@local/dsh-team-workflow",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region \0dsh-css:@local/dsh-team-workflow/TeamAction.module.css
		const css = "._twf_root{position:relative}._twf_trigger{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:5px;padding:3px 7px;font-size:12px;display:inline-flex}._twf_trigger:hover,._twf_trigger:focus-visible{color:var(--dsw-alias-label-primary)}@container (width<=480px){._twf_triggerLabel{display:none}}._twf_count{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;font-size:12px;font-weight:400;line-height:16px}._twf_panel{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);z-index:100;box-sizing:border-box;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:min(500px,100vw - 32px);max-height:min(680px,100vh - 32px);box-shadow:var(--dsw-elevation-prominent);border:0;border-radius:12px;flex-direction:column;padding:8px 2px 0;display:flex;position:fixed;overflow:hidden}._twf_panel:before{content:\"\";z-index:-1;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);border-radius:12px;position:absolute;inset:0}._twf_panelCompact{width:min(320px,100vw - 32px)}._twf_panelCompact ._twf_roster{grid-template-columns:minmax(0,1fr)}._twf_body{--dsh-scrollbar-track-margin:8px;scrollbar-gutter:stable;flex:auto;min-height:0;padding:0 9px 16px 14px;overflow-y:auto}._twf_taskTitle{align-items:center;gap:8px;display:flex}._twf_taskTitle strong{font-size:13px;font-weight:500}._twf_panel h3{color:var(--dsw-alias-label-primary);align-items:center;gap:8px;margin:16px 0 8px 4px;font-size:13px;font-weight:500;display:flex}._twf_body section:first-of-type h3{margin-top:8px}._twf_roster{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;display:grid}._twf_member{--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);min-width:0;box-shadow:var(--dsw-elevation-stroke);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;border:0;border-radius:8px;align-items:flex-start;gap:8px;padding:10px 12px;display:flex}._twf_member:disabled{cursor:default}._twf_memberCurrent{--dsw-elevation-stroke-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent);box-shadow:var(--dsw-elevation-stroke), inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent)}._twf_member:not(:disabled):hover,._twf_member:not(:disabled):focus-visible{--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel)}._twf_memberDot{flex:none;align-items:center;height:1lh;display:inline-flex}._twf_inactiveIcon{color:var(--dsw-alias-label-tertiary)}._twf_memberText{flex-direction:column;min-width:0;display:flex}._twf_memberName{align-items:center;gap:5px;min-width:0;display:inline-flex}._twf_memberNameText,._twf_memberText small{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}._twf_memberModel{display:none}._twf_member:hover ._twf_memberModel,._twf_member:focus-visible ._twf_memberModel{display:inline}._twf_currentTag{text-overflow:ellipsis;flex:0 999 auto;min-width:0;padding:0 4px;font-size:10px;line-height:15px;display:inline-block;overflow:hidden}._twf_memberText small,._twf_meta{color:var(--dsw-alias-label-tertiary);font-size:11px}._twf_diagnostic,._twf_error,._twf_warning{color:var(--dsw-alias-state-error-primary)}._twf_tasks{flex-direction:column;gap:7px;display:flex}._twf_emptyNotice{color:var(--dsw-alias-label-tertiary);margin:16px 0 0 4px;font-size:12px}._twf_task{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:9px;padding:11px 13px}._twf_taskState{color:var(--dsw-alias-label-tertiary);align-items:center;gap:6px;margin-left:auto;font-size:11px;display:inline-flex}._twf_task p{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;margin:5px 0;font-size:12px;line-height:18px}._twf_clampedDescription{-webkit-line-clamp:2;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}._twf_expandToggle{float:right;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;align-items:center;gap:2px;margin-left:10px;padding:0;font-size:11px;line-height:20px;display:inline-flex}._twf_expandToggle:hover,._twf_expandToggle:focus-visible{color:var(--dsw-alias-label-primary)}._twf_expandToggle svg{transition:transform .12s}._twf_expandToggleOpen{transform:rotate(180deg)}._twf_meta{line-height:20px}._twf_meta>span{margin-right:10px}._twf_notice,._twf_error{align-items:center;gap:6px;padding:9px;font-size:12px;display:flex}";
		const ROLE_CSS = "._twf_memberText{flex:1}._twf_member ._twf_roleDuty,._twf_member ._twf_roleLine{white-space:normal;overflow:visible;text-overflow:clip;line-height:16px}._twf_roleDuty{color:var(--dsw-alias-label-secondary)}._twf_roleLabel{font-weight:500;margin-right:5px;color:var(--dsw-alias-label-tertiary)}._twf_statusCard{display:flex;align-items:center;gap:8px;margin:12px 4px 0;padding:9px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-stroke);font-size:12px;line-height:16px}._twf_statusText{flex:1;min-width:0;color:var(--dsw-alias-label-secondary)}._twf_statusButton{flex:none;cursor:pointer;border:0;border-radius:6px;padding:3px 8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px}._twf_statusButton:hover{background:var(--dsw-alias-bg-layer-4)}._twf_statusButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}._twf_detail{display:flex;flex-direction:column;gap:8px;margin-top:16px;color:var(--dsw-alias-label-primary)}._twf_detailTitle{margin:0;font-size:13px;font-weight:500}._twf_detailNote{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}._twf_detailList{display:flex;flex-direction:column;gap:6px}._twf_detailRole{border:.5px solid var(--dsw-alias-border-l2);border-radius:9px;padding:9px 11px;background:var(--dsw-alias-bg-layer-2)}._twf_detailHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap}._twf_detailName{font-size:12px}._twf_detailId{font-size:11px;color:var(--dsw-alias-label-tertiary)}._twf_detailCapability{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}._twf_detailLine{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}._twf_detailLabel{font-weight:500;margin-right:5px;color:var(--dsw-alias-label-tertiary)}._twf_detailWarn{margin:0;font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary)}._twf_configHint{margin:0 0 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}._twf_configList{display:flex;flex-direction:column;gap:8px;margin-top:12px}._twf_configRow{display:flex;align-items:center;justify-content:space-between;gap:10px}._twf_configLabel{font-size:12px;color:var(--dsw-alias-label-primary)}._twf_configFoot{margin-top:12px}._twf_configLink{cursor:pointer;border:0;padding:0;background:none;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:16px;text-decoration:underline}";
		const tagId = "@local/dsh-team-workflow/TeamAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@local/dsh-team-workflow";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css + ROLE_CSS;
			document.head.appendChild(tag);
		}
		var TeamAction_module_css_default = {
			"body": "_twf_body",
			"clampedDescription": "_twf_clampedDescription",
			"count": "_twf_count",
			"currentTag": "_twf_currentTag",
			"diagnostic": "_twf_diagnostic",
			"emptyNotice": "_twf_emptyNotice",
			"error": "_twf_error",
			"expandToggle": "_twf_expandToggle",
			"expandToggleOpen": "_twf_expandToggleOpen",
			"inactiveIcon": "_twf_inactiveIcon",
			"member": "_twf_member",
			"memberCurrent": "_twf_memberCurrent",
			"memberDot": "_twf_memberDot",
			"memberModel": "_twf_memberModel",
			"memberName": "_twf_memberName",
			"memberNameText": "_twf_memberNameText",
			"memberText": "_twf_memberText",
			"meta": "_twf_meta",
			"notice": "_twf_notice",
			"roleDuty": "_twf_roleDuty",
			"roleLine": "_twf_roleLine",
			"roleLabel": "_twf_roleLabel",
			"statusCard": "_twf_statusCard",
			"statusText": "_twf_statusText",
			"statusButton": "_twf_statusButton",
			"detail": "_twf_detail",
			"detailTitle": "_twf_detailTitle",
			"detailNote": "_twf_detailNote",
			"detailList": "_twf_detailList",
			"detailRole": "_twf_detailRole",
			"detailHead": "_twf_detailHead",
			"detailName": "_twf_detailName",
			"detailId": "_twf_detailId",
			"detailCapability": "_twf_detailCapability",
			"detailLine": "_twf_detailLine",
			"detailLabel": "_twf_detailLabel",
			"detailWarn": "_twf_detailWarn",
			"configHint": "_twf_configHint",
			"configList": "_twf_configList",
			"configRow": "_twf_configRow",
			"configLabel": "_twf_configLabel",
			"configFoot": "_twf_configFoot",
			"configLink": "_twf_configLink",
			"panel": "_twf_panel",
			"panelCompact": "_twf_panelCompact",
			"root": "_twf_root",
			"roster": "_twf_roster",
			"task": "_twf_task",
			"taskState": "_twf_taskState",
			"taskTitle": "_twf_taskTitle",
			"tasks": "_twf_tasks",
			"trigger": "_twf_trigger",
			"triggerLabel": "_twf_triggerLabel",
			"warning": "_twf_warning"
		};
		//#endregion
		//#region lib/types/client/TeamAction.js
		function statusKey(status) {
			switch (status) {
				case "pending": return "status.pending";
				case "in_progress": return "status.in_progress";
				case "completed": return "status.completed";
				/* v8 ignore next -- Team views omit deleted task tombstones. */
				case "deleted": return "status.completed";
			}
		}
		function memberStatusKey(status) {
			switch (status) {
				case "running": return "memberStatus.running";
				case "inactive": return "memberStatus.inactive";
				case "provisioning": return "memberStatus.provisioning";
				case "failed": return "memberStatus.failed";
			}
		}
		function memberDotState(status) {
			switch (status) {
				case "running":
				case "provisioning": return "ongoing";
				case "failed": return "error";
			}
		}
		function taskDotState(task) {
			switch (task.status) {
				case "pending": return task.ready ? "idle" : "warning";
				case "in_progress": return "ongoing";
				case "completed": return "done";
				/* v8 ignore next -- Team views omit deleted task tombstones. */
				case "deleted": return "idle";
			}
		}
		/**
		 * 角色行：沿用官方 .member 卡片视觉，内容 = 状态点 + 角色中文名 + Tag（角色 id）+ 状态词 + 职责简述。
		 * 口径见 C5.1（用户 2026-10-14 第二次 UI 裁决）：不再内联「产物 / 边界 / 能力」，
		 * 那三项与悬空技能改挂插件管理页的详情区块（C20.2）。
		 *
		 * 运行状态口径与官方完全一致（观感才一致）：
		 *   本地镜像 useSessionStatus 优先，host 快照 useSessions.byId 兜底，用 ?? 而不是 ||；
		 *   相位不是 active 就直接用相位；名册里没有对应成员时状态是 unassigned（未派发）。
		 *
		 * C7（用户 2026-10-14 决定）：点击进入该成员的会话详情，实现照抄官方——
		 *   行可点时调用 openTeammate(sessionId, liveId)，与官方同一入口、同一语义。
		 *   只有「未派发」以及官方也视为不可点（failed / provisioning）的行才禁用——
		 *   那些行没有可打开的成员会话，点了只会报错。
		 */
		function TeamMemberRow({ member, sessionId, useSessions, useSessionStatus, openTeammate, t }) {
		 const jsx = react_jsx_runtime.jsx;
		 const jsxs = react_jsx_runtime.jsxs;
		 const css = TeamAction_module_css_default;
		 const P = _deepseek_ai_dsh_client_ui_primitives;
		 const liveId = member.liveId;
		 const dispatched = liveId !== void 0;
		 const running = useSessionStatus((state) => state.get(liveId)?.running);
		 const summaryRunning = useSessions((state) => state.byId[liveId]?.running);
		 const status = dispatched === false ? "unassigned"
		  : member.livePhase !== "active" ? member.livePhase
		  : (running ?? summaryRunning) === true ? "running" : "inactive";
		 const dotState = status === "failed" ? "error" : status === "running" || status === "provisioning" ? "ongoing" : void 0;
		 const openable = dispatched && status !== "failed" && status !== "provisioning";
		 // C5.1：悬停提示固定为官方原文那一句；不可点的行与官方一样 disabled（不给提示）。
		 return jsx(P.Tooltip, {
		  label: t("open"),
		  disabled: !openable,
		  side: "bottom",
		  gap: 4,
		  children: jsxs("button", {
		   type: "button",
		   disabled: !openable,
		   onClick: openable ? () => openTeammate(sessionId, liveId) : void 0,
		   className: css.member,
		   children: [jsx("span", {
		    className: css.memberDot,
		    children: dotState === void 0
		     ? jsx(P.IconUserOutlineRegular, { size: 14, className: css.inactiveIcon })
		     : jsx(P.StateDot, { state: dotState })
		   }), jsxs("span", {
		   className: css.memberText,
		   children: [
		    jsxs("span", { className: css.memberName, children: [
		     jsx("span", { className: css.memberNameText, children: member.name }),
		     jsx(P.Tag, { tone: "info", className: css.currentTag, children: member.id }),
		     jsx("small", { className: css.meta, children: t("memberStatus." + status) })
		    ] }),
		    jsx("small", { className: css.roleDuty, children: member.duty })
		   ]
		  })]
		  })
		 });
		}
		/** Task card with a two-line description clamp expanded from a toggle in the meta row. */
		function TaskCard({ task, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [clamped, setClamped] = (0, react.useState)(false);
			const textRef = (0, react.useRef)(null);
			(0, react.useLayoutEffect)(() => {
				if (expanded) return;
				const paragraph = textRef.current;
				/* v8 ignore next -- the paragraph mounts in the same commit as the effect. */
				if (paragraph === null) return;
				const measure = () => {
					setClamped(paragraph.scrollHeight > paragraph.clientHeight + 1);
				};
				measure();
				if (typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver(measure);
				observer.observe(paragraph);
				return () => {
					observer.disconnect();
				};
			}, [task.description, expanded]);
			return (0, react_jsx_runtime.jsxs)("article", {
				className: TeamAction_module_css_default.task,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: TeamAction_module_css_default.taskTitle,
						children: [(0, react_jsx_runtime.jsx)("strong", { children: task.subject }), (0, react_jsx_runtime.jsxs)("span", {
							className: TeamAction_module_css_default.taskState,
							children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: taskDotState(task) }), (0, react_jsx_runtime.jsx)("span", { children: t(statusKey(task.status)) })]
						})]
					}),
					(0, react_jsx_runtime.jsx)("p", {
						ref: textRef,
						className: expanded ? void 0 : TeamAction_module_css_default.clampedDescription,
						children: task.description
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: TeamAction_module_css_default.meta,
						children: [
							(clamped || expanded) && (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: TeamAction_module_css_default.expandToggle,
								"aria-expanded": expanded,
								onClick: () => {
									setExpanded((current) => !current);
								},
								children: [t(expanded ? "task.collapse" : "task.expand"), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
									size: 12,
									className: expanded ? TeamAction_module_css_default.expandToggleOpen : void 0
								})]
							}),
							(0, react_jsx_runtime.jsx)("span", { children: task.id }),
							(0, react_jsx_runtime.jsxs)("span", { children: [
								t("owner"),
								": ",
								task.ownerName ?? t("unowned")
							] }),
							task.status === "pending" && (0, react_jsx_runtime.jsx)("span", { children: task.ready ? t("ready") : t("blocked") }),
							task.blockedBy.length > 0 && (0, react_jsx_runtime.jsxs)("span", { children: [
								t("blockedBy"),
								": ",
								task.blockedBy.join(", ")
							] }),
							task.writeScopes.length > 0 && (0, react_jsx_runtime.jsxs)("span", { children: [
								t("writeScopes"),
								": ",
								task.writeScopes.join(", ")
							] }),
							task.writeScopeWarnings.map((warning) => (0, react_jsx_runtime.jsx)("span", {
								className: TeamAction_module_css_default.warning,
								children: warning
							}, warning))
						]
					})
				]
			});
		}
		/** Render the Team roster and read-only task board. */
		/**
		 * 本工作流的角色名册——来自资源包 sources/omp/agents/*.md（经 roles.json 内联）。
		 * 不是通用的“任意成员”列表：角色按需实例化，不常驻。
		 */
		const WORKFLOW_ROLES = [{"id":"pm","title":"产品经理","duty":"把用户意图转成有范围、可测的产品需求与验收标准。","outputs":["PRD 草稿","用户流","明确的非目标","优先级","验收标准","未决问题"],"boundaries":"不改代码、不选技术架构、不批准例外、不直接联系用户。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","product-delivery","pm-requirements","cross-team-contract-alignment","hermes-obsidian"],"danglingSkills":[]},{"id":"architect","title":"架构师","duty":"设计技术边界、契约与 ADR 草案，但不实现它们。","outputs":["可实施的技术方案","接口契约","所有权边界","ADR 影响分析"],"boundaries":"不改实现、不擅自修订生效 ADR、不批准例外；重大架构变更须经主 Agent 以 needs-authorization 上报。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","architecture-delivery","cross-team-contract-alignment","database-design-checklist","web-architecture-patterns","hermes-obsidian"],"danglingSkills":[]},{"id":"backend","title":"后端","duty":"仅在指派路径与契约内实现已批准的后端与数据层工作。","outputs":["变更路径","验证证据","风险","所需的下一道门"],"boundaries":"不改架构 / CI-CD / 生产部署文件 / 密钥，不改自己的评审状态；schema 与迁移按串行共享所有权处理。","tools":["read","grep","glob","edit","write","bash","lsp"],"writable":true,"autoloadSkills":["team-workflow","backend-delivery","database-design-checklist","web-architecture-patterns","hermes-obsidian"],"danglingSkills":[]},{"id":"frontend","title":"前端","duty":"仅在指派路径与契约内实现已批准的前端工作。","outputs":["变更路径","验证证据","风险","所需的下一道门"],"boundaries":"保持后端与共享 schema 契约；不改架构、受保护部署文件、密钥或自己的评审状态。","tools":["read","grep","glob","edit","write","bash","lsp"],"writable":true,"autoloadSkills":["team-workflow","frontend-delivery","react-best-practices","hermes-obsidian"],"danglingSkills":["react-page-implementation"]},{"id":"harness","title":"智能体","duty":"在指派路径内实现已批准的 agent 运行时、模型、提示、工具、MCP 与编排改动。","outputs":["变更路径","被实际执行的行为","风险","所需的下一道门"],"boundaries":"不重定义系统授权、权限模型、跨服务契约或架构；绝不在工件中暴露凭据。","tools":["read","grep","glob","edit","write","bash","lsp"],"writable":true,"autoloadSkills":["team-workflow","harness-delivery","cross-team-contract-alignment","web-architecture-patterns","hermes-obsidian"],"danglingSkills":[]},{"id":"devops","title":"运维","duty":"设计并执行获授权的交付、部署与运行时操作。","outputs":["确切目标环境","不可变工件与完整 Docker 清单","回滚门","命令证据","风险","下一道门"],"boundaries":"未经记录的授权不得操作真实基础设施、密钥、账号、受保护 CI/CD，也不得执行部署/推送/提交；构建、候选、发布、清理四道门相互独立。","tools":["read","grep","glob","edit","write","bash"],"writable":true,"autoloadSkills":["team-workflow","operations-delivery","docker-artifact-safety","hermes-obsidian"],"danglingSkills":[]},{"id":"qa","title":"测试","duty":"独立测试被指派的改动，并报告可复现缺陷而不修复它们。","outputs":["独立推导并执行的测试证据","缺陷（含复现、期望与实际、受影响 revision、严重度、实现 owner）"],"boundaries":"不修改被测实现、不批准自己的证据、不把未执行的测试报告为通过。","tools":["read","grep","glob","bash"],"writable":true,"autoloadSkills":["team-workflow","qa-delivery","verification-before-completion","anti-fake-testing","hermes-obsidian"],"danglingSkills":[]},{"id":"code-review","title":"代码审查","duty":"独立审查实现 diff、证据与交接的正确性与可维护性。","outputs":["发现项（含严重度、受影响路径与行/构造、后果、具体修复建议）"],"boundaries":"不改实现、不自审、不编造测试结果。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","code-review-delivery","code-review-defect-patterns","hermes-obsidian"],"danglingSkills":["branch-diff-static-review"]},{"id":"compliance","title":"合规","duty":"独立评估安全、策略、授权与架构边界的合规性。","outputs":["每条结论归类为 pass / risk / block / needs-authorization 并附具体证据"],"boundaries":"不修改被审实现、不豁免违规、不冒用用户授权。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","compliance-delivery","security-test-matrix","hermes-obsidian"],"danglingSkills":[]},{"id":"quota-control","title":"资源财务","duty":"分析团队用量证据，报告预算、重试与容量异常。","outputs":["事实","数据缺口","阈值突破","建议"],"boundaries":"不取消工作、不改模型、不改预算、不声称未经权威来源提供的测量值。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","quota-governance","hermes-obsidian"],"danglingSkills":[]}];
		/**
		 * 把角色名册与 agentTeam 投影里的真实成员对齐。
		 * 约定：成员名 = 角色 id（允许 qa-2 这类后缀）。理由见 README——策略层判定派发授权时
		 * 也是按这个名字匹配的，两边用同一套命名才对得上。
		 */
		function findLiveMember(members, roleId) {
		 if (!Array.isArray(members)) return void 0;
		 for (const candidate of members) {
		  if (candidate.name === roleId) return candidate;
		  if (typeof candidate.name === "string" && candidate.name.indexOf(roleId + "-") === 0) return candidate;
		 }
		 return void 0;
		}
		/** 官方卡片期望 { members, tasks } 形状；任务段留空，由工件链说明替代。 */
		function workflowRoster(liveTeam) {
		 const liveMembers = liveTeam && Array.isArray(liveTeam.members) ? liveTeam.members : [];
		 return {
		  members: WORKFLOW_ROLES.map((role) => {
		   const live = findLiveMember(liveMembers, role.id);
		   return {
		    id: role.id,
		    name: role.title,
		    duty: role.duty,
		    outputs: role.outputs,
		    boundaries: role.boundaries,
		    tools: role.tools,
		    writable: role.writable,
		    autoloadSkills: role.autoloadSkills,
		    danglingSkills: role.danglingSkills,
		    liveId: live === void 0 ? void 0 : live.id,
		    livePhase: live === void 0 ? void 0 : live.phase
		   };
		  }),
		  // C20.4：官方任务板的数据源——直接透传投影里的 tasks（用户 2026-10-14：任务板借鉴官方设计）。
		  // 以前写死 []，官方那套任务卡（两行截断展开、Owner/依赖/写入范围/数量徽标）永远不出现。
		  tasks: liveTeam && Array.isArray(liveTeam.tasks) ? liveTeam.tasks : [],
		  // 投影报"持久化记录非法"时官方有失败横幅；以前没透传 failure，那条分支是死的。
		  ...(liveTeam && liveTeam.failure !== void 0 ? { failure: liveTeam.failure } : {})
		 };
		}
		/**
		 * C21.2：配置的六个字段与默认值。**默认值必须等于改动前的行为**——配置功能本身
		 * 不得改变任何现有行为（门 6f/6h 在默认值下必须与改前等价）。
		 */
		const CONFIG_FIELDS = ["disabledRoles", "autoloadSkills", "routeGuard", "showTaskBoard", "hideUnassignedRoles", "forceCompactPanel"];
		const CONFIG_DEFAULTS = { disabledRoles: [], autoloadSkills: true, routeGuard: true, showTaskBoard: true, hideUnassignedRoles: false, forceCompactPanel: false };
		/** C21.3 降级：设置服务缺席时用这个视图（显示"不可写"，绝不抛错）。 */
		const CONFIG_EMPTY_VIEW = { available: false, writable: false, dirty: false, invalid: false, saving: false, failed: false, value: CONFIG_DEFAULTS, fields: {} };
		/** 布尔字段的转换规格：Switch 用 edit(field, "true"/"false") 暂存。 */
		function configBooleanSpec(field) {
		 return {
		  field,
		  format: (value) => value === true ? "true" : "false",
		  parse: (text) => text === "true" ? { kind: "set", value: true } : text === "false" ? { kind: "set", value: false } : void 0
		 };
		}
		/** 角色 id 列表的转换规格：逗号/空白分隔；清空等于清除覆盖（恢复默认）。 */
		function configRolesSpec(field) {
		 return {
		  field,
		  format: (value) => Array.isArray(value) ? value.join(", ") : "",
		  parse: (text) => {
		   const list = text.split(/[,，\s]+/).filter(Boolean);
		   return list.length === 0 ? { kind: "clear" } : { kind: "set", value: list };
		  }
		 };
		}
		/** C21.3：订阅官方设置表单；缺席或抛错时给兜底视图。 */
		function useConfigView(config) {
		 const [view, setView] = (0, react.useState)(() => config !== void 0 && typeof config.snapshot === "function" ? config.snapshot() : CONFIG_EMPTY_VIEW);
		 (0, react.useEffect)(() => {
		  if (config === void 0 || typeof config.subscribe !== "function") return void 0;
		  setView(config.snapshot());
		  return config.subscribe(() => { setView(config.snapshot()); });
		 }, [config]);
		 return view;
		}
		function TeamAction({ sessionId, useSession, useSessions, useSessionStatus, openTeammate, config, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [configOpen, setConfigOpen] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const triggerLabelRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const position = (0, _deepseek_ai_dsh_client_ui_primitives.useAnchoredPosition)({
				open,
				anchorRef: triggerRef,
				panelRef,
				gap: 5,
				margin: 16
			});
			const positioned = position !== null;
			const leadSessionId = useSession((snapshot) => snapshot.subagent?.address.parentSessionId) ?? sessionId;
						const liveTeam = useSessions((state) => state.projectionsBySession[leadSessionId]?.values.agentTeam);
			const team = workflowRoster(liveTeam);
			// C21.2/C21.3：展示层三个字段的消费点；配置值只从 props.config（宿主 volatile Config）来。
			const configView = useConfigView(config);
			const configValues = configView.value ?? CONFIG_DEFAULTS;
			// hideUnassignedRoles：未派发 = 没有对应实时成员（liveId 为空）。
			const configRows = configValues.hideUnassignedRoles === true
			 ? (team === void 0 ? [] : team.members.filter((member) => member.liveId !== void 0))
			 : (team === void 0 ? [] : team.members);
			const opening = useSession((snapshot) => snapshot.openState === "loading");
			const listing = useSessions((state) => state.phase === "pending");
			const hoverTimer = (0, react.useRef)(void 0);
			const pinnedRef = (0, react.useRef)(false);
			const cancelHoverChange = () => {
				clearTimeout(hoverTimer.current);
				hoverTimer.current = void 0;
			};
			(0, react.useEffect)(() => {
				cancelHoverChange();
				pinnedRef.current = false;
				setOpen(false);
				setError(null);
			}, [sessionId]);
			(0, react.useEffect)(() => cancelHoverChange, []);
			(0, react.useLayoutEffect)(() => {
				if (open && positioned && pinnedRef.current) panelRef.current?.focus();
			}, [open, positioned]);
			const changeOpen = (next) => {
				cancelHoverChange();
				if (!next) pinnedRef.current = false;
				setOpen(next);
			};
			const scheduleHoverOpen = () => {
				cancelHoverChange();
				if (open) return;
				const label = triggerLabelRef.current;
				/* v8 ignore next -- the label mounts with the trigger that received the hover. */
				if (label === null) return;
				if (getComputedStyle(label).display === "none") return;
				hoverTimer.current = setTimeout(() => {
					hoverTimer.current = void 0;
					changeOpen(true);
				}, 150);
			};
			const scheduleHoverClose = () => {
				cancelHoverChange();
				if (pinnedRef.current) return;
				hoverTimer.current = setTimeout(() => {
					hoverTimer.current = void 0;
					changeOpen(false);
				}, 120);
			};
			(0, _deepseek_ai_dsh_client_ui_primitives.useDismissOnOutsidePointer)(rootRef, open, changeOpen, panelRef);
			(0, react.useEffect)(() => {
				if (!open) return;
				const dismiss = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					cancelHoverChange();
					pinnedRef.current = false;
					setOpen(false);
					if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
				};
				document.addEventListener("keydown", dismiss);
				return () => {
					document.removeEventListener("keydown", dismiss);
				};
			}, [open]);
			const compact = configValues.forceCompactPanel === true || (team !== void 0 && team.members.length === 1 && team.tasks.length === 0);
			return (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: TeamAction_module_css_default.root,
				"data-team-action": true,
				onMouseLeave: scheduleHoverClose,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					ref: triggerRef,
					onMouseEnter: scheduleHoverOpen,
					className: TeamAction_module_css_default.trigger,
					"aria-label": t("trigger"),
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					onClick: () => {
						cancelHoverChange();
						pinnedRef.current = true;
						if (!open) changeOpen(true);
						else panelRef.current?.focus();
					},
					children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUsersOutlineRegular, { size: 14 }), (0, react_jsx_runtime.jsx)("span", {
						ref: triggerLabelRef,
						className: TeamAction_module_css_default.triggerLabel,
						children: t("trigger")
					})]
				}), (0, react_jsx_runtime.jsx)(TeamWorkflowConfigDialog, {
									open: configOpen,
									onClose: () => setConfigOpen(false),
									config,
									t
								}), open && (0, react_dom.createPortal)((0, react_jsx_runtime.jsx)("div", {
					ref: panelRef,
					className: compact ? `${TeamAction_module_css_default.panel} ${TeamAction_module_css_default.panelCompact}` : TeamAction_module_css_default.panel,
					style: position ?? {
						visibility: "hidden",
						left: 0,
						top: 0
					},
					role: "dialog",
					tabIndex: -1,
					"aria-label": t("trigger"),
					"data-team-panel": true,
					onMouseEnter: cancelHoverChange,
					onMouseLeave: scheduleHoverClose,
					children: (0, react_jsx_runtime.jsxs)("div", {
						className: TeamAction_module_css_default.body,
						children: [
							error !== null && (0, react_jsx_runtime.jsxs)("div", {
								className: TeamAction_module_css_default.error,
								role: "alert",
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), error]
							}),
							team === void 0 && (0, react_jsx_runtime.jsxs)("div", {
								className: TeamAction_module_css_default.notice,
								role: "status",
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: opening || listing ? "ongoing" : "warning" }), t(opening || listing ? "loading" : "unavailable")]
							}),
							team !== void 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								team.failure !== void 0 && (0, react_jsx_runtime.jsxs)("div", {
									className: TeamAction_module_css_default.error,
									role: "alert",
									children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), t("failure", { message: team.failure })]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: TeamAction_module_css_default.statusCard,
									children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUsersOutlineRegular, {
										size: 14
									}), (0, react_jsx_runtime.jsx)("span", {
										className: TeamAction_module_css_default.statusText,
										role: "status",
										children: t("pluginStatus")
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: TeamAction_module_css_default.statusButton,
										onClick: () => setConfigOpen(true),
										children: t("configButton")
									})]
								}),
								(0, react_jsx_runtime.jsxs)("section", { children: [(0, react_jsx_runtime.jsxs)("h3", { children: [t("roster"), configRows.length > 1 && (0, react_jsx_runtime.jsx)("span", {
									className: TeamAction_module_css_default.count,
									children: configRows.length
								})] }), (0, react_jsx_runtime.jsx)("div", {
									className: TeamAction_module_css_default.roster,
									children: configRows.map((member) => (0, react_jsx_runtime.jsx)(TeamMemberRow, {
										member,
										memberCount: team.members.length,
										sessionId,
										useSessions,
										useSessionStatus,
										openTeammate,
										onError: setError,
										t
									}, member.id))
								})] }),
								configValues.showTaskBoard !== false && (0, react_jsx_runtime.jsx)("section", { children: team.tasks.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
									className: TeamAction_module_css_default.emptyNotice,
									children: t("empty")
								}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("h3", { children: [t("tasks"), (0, react_jsx_runtime.jsx)("span", {
									className: TeamAction_module_css_default.count,
									children: team.tasks.length
								})] }), (0, react_jsx_runtime.jsx)("div", {
									className: TeamAction_module_css_default.tasks,
									children: team.tasks.map((task) => (0, react_jsx_runtime.jsx)(TaskCard, {
										task,
										t
									}, task.id))
								})] }) })
							] })
						]
					})
				}), document.body)]
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Agent Teams Web dictionaries. */
		/** Locale namespace owned by the Agent Teams Web UI. */
		const NS = "dsh-team-workflow";
		/** Simplified Chinese dictionary and key source. */
		const zh = {
			trigger: "Agent 团队工作流",
			loading: "正在加载团队…",
			unavailable: "Team 暂不可用",
			failure: "团队持久记录无效：{message}",
			empty: "暂无共享任务，可以通过对话创建",
			roster: "角色分工",
			outputs: "产物",
			boundaries: "边界",
			capability: "能力",
			writable: "可写",
			readonly: "只读",
			skills: "技能",
			dangling: "悬空技能（已移出自动加载）",
			"memberStatus.unassigned": "未派发",
			"pluginStatus": "本插件接管中 · 官方「智能体团队」未启用",
			"pluginManager": "打开插件管理",
			"detailTitle": "角色分工与能力边界",
			"detailNote": "卡片只显示运行状态与职责；完整的产物、边界、技能可加载性放在这里。工件链：PRD → ADR（仅持久决策时）→ Tech Spec → 实施计划 → Test Spec → QA 验收报告。",
			"configButton": "配置",
			"configTitle": "Agent 团队工作流 · 配置",
			"configClose": "关闭",
			"configHint": "改动经官方设置服务写回宿主并保存在当前 profile；默认值与改动前行为一致。",
			"configOpenManager": "在插件管理页中查看",
			"cfgDisabledRoles": "停用角色",
			"cfgDisabledRolesHint": "逗号分隔的角色 id；停用后 /team 名册与简报不再包含它们",
			"cfgAutoloadSkills": "派发简报附技能清单",
			"cfgRouteGuard": "强制写明路线触发原因",
			"cfgShowTaskBoard": "显示共享任务板",
			"cfgHideUnassignedRoles": "隐藏未派发角色",
			"cfgForceCompactPanel": "强制紧凑面板",
			"formSave": "保存",
			"formSaving": "保存中…",
			"formSaveFailed": "宿主拒绝了这次保存",
			"formReadOnly": "只读",
			"formUnavailable": "设置服务不可用",
			"formOverridden": "已覆盖",
			"formReset": "重置",
			"formInvalid": "无效",
			tasks: "共享任务",
			model: "模型",
			open: "打开成员会话",
			current: "当前会话",
			owner: "Owner",
			unowned: "未分配",
			blockedBy: "依赖",
			writeScopes: "写入范围",
			ready: "可开始",
			blocked: "被依赖阻塞",
			"task.expand": "展开",
			"task.collapse": "收起",
			"memberStatus.running": "运行中",
			"memberStatus.inactive": "未运行",
			"memberStatus.provisioning": "准备中",
			"memberStatus.failed": "失败",
			"status.pending": "待处理",
			"status.in_progress": "进行中",
			"status.completed": "已完成"
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			trigger: "Agent Team Workflow",
			loading: "Loading Team…",
			unavailable: "Team is unavailable",
			failure: "Invalid persisted Team record: {message}",
			empty: "No shared tasks yet. Create them through the conversation.",
			roster: "Roles",
			outputs: "Outputs",
			boundaries: "Boundaries",
			capability: "Capability",
			writable: "writable",
			readonly: "read-only",
			skills: "skills",
			dangling: "Dangling skills (removed from autoload)",
			"memberStatus.unassigned": "Not dispatched",
			"pluginStatus": "This plugin is active · official Agent Team plugin not enabled",
			"pluginManager": "Open plugin manager",
			"detailTitle": "Role duties and capability boundaries",
			"detailNote": "The card shows running state and duty only; full deliverables, boundaries, and skill loadability live here. Artifact chain: PRD → ADR (persistent decisions only) → Tech Spec → implementation plan → Test Spec → QA acceptance report.",
			"configButton": "Configure",
			"configTitle": "Agent Team Workflow · Configuration",
			"configClose": "Close",
			"configHint": "Changes are written back through the official settings service and stored in the current profile; defaults match the previous behavior.",
			"configOpenManager": "View in plugin manager",
			"cfgDisabledRoles": "Disabled roles",
			"cfgDisabledRolesHint": "Comma-separated role ids; disabled roles are dropped from /team roster and briefs",
			"cfgAutoloadSkills": "Attach skill list to dispatch briefs",
			"cfgRouteGuard": "Require a trigger reason for route declarations",
			"cfgShowTaskBoard": "Show shared task board",
			"cfgHideUnassignedRoles": "Hide undispatched roles",
			"cfgForceCompactPanel": "Force compact panel",
			"formSave": "Save",
			"formSaving": "Saving…",
			"formSaveFailed": "The host rejected this save",
			"formReadOnly": "Read-only",
			"formUnavailable": "Settings service unavailable",
			"formOverridden": "Overridden",
			"formReset": "Reset",
			"formInvalid": "Invalid",
			tasks: "Shared tasks",
			model: "Model",
			open: "Open member conversation",
			current: "Current chat",
			owner: "Owner",
			unowned: "Unowned",
			blockedBy: "Blocked by",
			writeScopes: "Write scopes",
			ready: "Ready",
			blocked: "Blocked by dependencies",
			"task.expand": "Show more",
			"task.collapse": "Show less",
			"memberStatus.running": "Running",
			"memberStatus.inactive": "Inactive",
			"memberStatus.provisioning": "Provisioning",
			"memberStatus.failed": "Failed",
			"status.pending": "Pending",
			"status.in_progress": "In progress",
			"status.completed": "Completed"
		};
		//#endregion
		//#region lib/types/client/mount.js
		/** Source-safe Agent Teams browser registration. */
		/** Required browser services for navigation, slots, and localized copy. */
		const inject = [
			"sessions",
			"configForms",
			"uiWorkspace",
			"slots",
			"locale"
		];
		/**
		* Register the Team locale dictionaries and the conversation-header action.
		* The panel reads the Lead Session's `agentTeam` projection from the shared
		* Session store; this registration performs no Team RPC.
		* @param ctx - Client Context carrying the injected navigation, locale, slot, and Session services.
		*/
		/**
		 * C20.2：只在本组合包的插件管理详情页渲染的角色与能力边界区块。
		 * subject 由官方管理器传入（kind: bundle/row/item）；kind 不是 bundle、或不是本包时返回 null，
		 * 也就是对别人的页面无话可说——绝不在别处插内容。
		 */
		function TeamWorkflowDetailSection({ subject, t }) {
		 const jsx = react_jsx_runtime.jsx;
		 const jsxs = react_jsx_runtime.jsxs;
		 const css = TeamAction_module_css_default;
		 if (subject === void 0 || subject.kind !== "bundle" || subject.pkg === void 0
		  || subject.pkg.name !== "@local/dsh-team-workflow") return null;
		 const dangling = WORKFLOW_ROLES.filter((role) => (role.danglingSkills ?? []).length > 0);
		 return jsxs("section", { className: css.detail, children: [
		  jsx("h4", { className: css.detailTitle, children: t("detailTitle") }),
		  jsx("p", { className: css.detailNote, children: t("detailNote") }),
		  jsx("div", { className: css.detailList, children: WORKFLOW_ROLES.map((role) => jsxs("div", {
		   className: css.detailRole,
		   children: [jsxs("div", { className: css.detailHead, children: [
		    jsx("b", { className: css.detailName, children: role.title }),
		    jsx("span", { className: css.detailId, children: role.id }),
		    jsx("span", { className: css.detailCapability, children: (role.writable ? t("writable") : t("readonly"))
		     + " · " + role.tools.join(", ") + " · " + role.autoloadSkills.length + " " + t("skills") })
		   ] }),
		   jsx("div", { className: css.detailLine, children: role.duty }),
		   jsxs("div", { className: css.detailLine, children: [
		    jsx("b", { className: css.detailLabel, children: t("outputs") }),
		    role.outputs.join(" · ")
		   ] }),
		   jsxs("div", { className: css.detailLine, children: [
		    jsx("b", { className: css.detailLabel, children: t("boundaries") }),
		    role.boundaries
		   ] })
		  ] }, role.id)) }),
		  dangling.length > 0 && jsx("p", { className: css.detailWarn, children:
		   "⚠ " + t("dangling") + "：" + dangling.map((role) => role.id + " → " + role.danglingSkills.join("、")).join("；") })
		 ] });
		}

		/**
		 * C1 的实现坐标（见 CONSTITUTION.md C3/C13）。**本文件唯一允许出现官方 slot id 的地方**：
		 * 它只用于「与官方占同一个格子」，locale / 样式前缀 / 模块 id 仍然是自己的，所以不会撞车。
		 */
		const SLOT_NAME = "conversation.session.header.actions";
		const OFFICIAL_SLOT_ID = "agent-team";
		const SHADOW_PRIORITY = 100;
		/** C21.3：配置条目 id 必须与 profile 里的 `- id:` 一致（改名即断）。 */
		const CONFIG_ENTRY_ID = "team-workflow";
		/**
		 * C21.3：配置的读写把手，挂在官方设置服务 ctx.configForms 上（键 = profile 条目 id）。
		 * **不另存 localStorage、不建配置文件**；任何一步失败都降级成"不可写"，绝不抛错——
		 * 客户端 entry 抛错会让整个 GUI 停在 "Failed to load plugins"（同 C1 的让位纪律）。
		 */
		function createConfigController(ctx, openPluginManager) {
		 const P = _deepseek_ai_dsh_client_ui_primitives;
		 let scope;
		 let model;
		 try {
		  const forms = ctx.configForms;
		  if (forms !== void 0 && typeof forms.get === "function") scope = forms.get(CONFIG_ENTRY_ID);
		 } catch (error) { scope = void 0; }
		 try {
		  if (scope !== void 0 && typeof P.SettingsFormModel === "function") {
		   model = new P.SettingsFormModel(scope, [
		    configRolesSpec("disabledRoles"),
		    configBooleanSpec("autoloadSkills"),
		    configBooleanSpec("routeGuard"),
		    configBooleanSpec("showTaskBoard"),
		    configBooleanSpec("hideUnassignedRoles"),
		    configBooleanSpec("forceCompactPanel")
		   ], []);
		  }
		 } catch (error) { model = void 0; }
		 const readSnapshot = () => {
		  try { return scope === void 0 ? void 0 : scope.getSnapshot(); } catch (error) { return void 0; }
		 };
		 const readValues = () => {
		  const snapshot = readSnapshot();
		  const raw = snapshot !== void 0 && snapshot.value !== void 0 ? snapshot.value : {};
		  const values = {};
		  for (const field of CONFIG_FIELDS) values[field] = raw[field] === void 0 ? CONFIG_DEFAULTS[field] : raw[field];
		  return values;
		 };
		 return {
		  snapshot() {
		   const shell = model === void 0 ? CONFIG_EMPTY_VIEW : model.shell();
		   const fields = {};
		   if (model !== void 0) for (const field of CONFIG_FIELDS) fields[field] = model.field(field);
		   return {
		    available: shell.available === true,
		    writable: shell.writable === true,
		    dirty: shell.dirty === true,
		    invalid: shell.invalid === true,
		    saving: shell.saving === true,
		    failed: shell.failed === true,
		    value: readValues(),
		    fields
		   };
		  },
		  subscribe(listener) {
		   if (scope === void 0 || typeof scope.subscribe !== "function") return () => {};
		   try {
		    const dispose = scope.subscribe(listener);
		    return typeof dispose === "function" ? dispose : () => {};
		   } catch (error) { return () => {}; }
		  },
		  values: readValues,
		  edit(field, text) { if (model !== void 0) model.actions().edit(field, text); },
		  resetField(field) { if (model !== void 0) model.actions().resetField(field); },
		  save() { return model === void 0 ? void 0 : model.actions().save(); },
		  discard() { if (model !== void 0) model.actions().discard(); },
		  openManager() { openPluginManager(); },
		  dispose() { try { if (model !== void 0 && typeof model.dispose === "function") model.dispose(); } catch (error) {} }
		 };
		}
		/**
		 * C21.1：自有配置弹窗。浮层/遮罩/Esc/Tab/焦点归还是一律交给官方 Modal（useModalLayer），
		 * 控件是官方 Switch / SettingsValueField，表单外观是官方 SettingsForm——不自造视觉。
		 * 底部「在插件管理页中查看」是保留下来的官方入口（C20.3 改写后降级为次级链接）。
		 */
		function TeamWorkflowConfigDialog({ open, onClose, config, t }) {
		 const P = _deepseek_ai_dsh_client_ui_primitives;
		 const jsx = react_jsx_runtime.jsx;
		 const jsxs = react_jsx_runtime.jsxs;
		 const css = TeamAction_module_css_default;
		 const view = useConfigView(config);
		 if (open !== true) return null;
		 const values = view.value ?? CONFIG_DEFAULTS;
		 const writable = view.writable === true;
		 const fields = view.fields ?? {};
		 const stage = (field, text) => {
		  if (config !== void 0 && typeof config.edit === "function") config.edit(field, text);
		 };
		 const switchRow = (field, labelKey) => jsx("div", {
		  className: css.configRow,
		  children: [
		   jsx("span", { className: css.configLabel, children: t(labelKey) }),
		   jsx(P.Switch, {
		    checked: values[field] === true,
		    label: t(labelKey),
		    disabled: writable !== true,
		    onChange: (next) => stage(field, next === true ? "true" : "false")
		   })
		  ]
		 }, field);
		 const roles = fields.disabledRoles ?? { text: "", overridden: false, invalid: false };
		 return jsx(P.Modal, {
		  open: true,
		  onClose,
		  title: t("configTitle"),
		  closeLabel: t("configClose"),
		  children: jsxs(P.SettingsForm, {
		   labels: {
		    unavailable: t("formUnavailable"),
		    readOnly: t("formReadOnly"),
		    saveFailed: t("formSaveFailed"),
		    save: t("formSave"),
		    saving: t("formSaving")
		   },
		   state: {
		    available: view.available === true,
		    writable,
		    dirty: view.dirty === true,
		    invalid: view.invalid === true,
		    saving: view.saving === true,
		    failed: view.failed === true
		   },
		   onSave: () => { if (config !== void 0 && typeof config.save === "function") config.save(); },
		   onDiscard: () => { if (config !== void 0 && typeof config.discard === "function") config.discard(); },
		   children: [
		    jsx("p", { className: css.configHint, children: t("configHint") }),
		    jsx(P.SettingsValueField, {
		     id: "twf-config-disabled-roles",
		     label: t("cfgDisabledRoles"),
		     hint: t("cfgDisabledRolesHint"),
		     overriddenLabel: t("formOverridden"),
		     resetLabel: t("formReset"),
		     invalidLabel: t("formInvalid"),
		     disabled: writable !== true,
		     text: roles.text,
		     overridden: roles.overridden === true,
		     invalid: roles.invalid === true,
		     onEdit: (text) => stage("disabledRoles", text),
		     onReset: () => { if (config !== void 0 && typeof config.resetField === "function") config.resetField("disabledRoles"); }
		    }),
		    jsx("div", { className: css.configList, children: [
		     switchRow("autoloadSkills", "cfgAutoloadSkills"),
		     switchRow("routeGuard", "cfgRouteGuard"),
		     switchRow("showTaskBoard", "cfgShowTaskBoard"),
		     switchRow("hideUnassignedRoles", "cfgHideUnassignedRoles"),
		     switchRow("forceCompactPanel", "cfgForceCompactPanel")
		    ] }),
		    jsx("div", { className: css.configFoot, children: jsx("button", {
		     type: "button",
		     className: css.configLink,
		     onClick: () => { if (config !== void 0 && typeof config.openManager === "function") config.openManager(); },
		     children: t("configOpenManager")
		    }) })
		   ]
		  })
		 });
		}

		function registerAgentTeamUi(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "@local/dsh-team-workflow: dictionaries");
			const sessions = ctx.sessions;
			const leadSessionId = (sessionId) => {
				return (sessions.binding(sessionId)?.session.getSnapshot().subagent?.address)?.parentSessionId ?? sessionId;
			};
			/**
			 * C20.3：打开插件管理面板并直达本组合包详情页。
			 * 平台没有"插件管理弹窗"API——openBundle 打开的是侧栏「插件」面板（已向用户说明并获确认）；
			 * 官方管理器缺席时降级为切到「插件」面板；两者都没有则静默无操作（绝不抛错）。
			 */
			const openPluginManager = () => {
			 const reflect = ctx.reflect;
			 if (reflect === void 0 || typeof reflect.get !== "function") return;
			 const navigation = reflect.get("pluginNavigation");
			 if (navigation !== void 0 && typeof navigation.openBundle === "function") {
			  navigation.openBundle("@local/dsh-team-workflow");
			  return;
			 }
			 const layout = reflect.get("layout");
			 if (layout !== void 0 && typeof layout.selectPanel === "function") layout.selectPanel("plugins");
			};
			const actions = { openTeammate(sessionId, childSessionId) {
				const parentSessionId = leadSessionId(sessionId);
				if ((sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) === 0) return;
				if (childSessionId === parentSessionId) {
					ctx.uiWorkspace.openSession(parentSessionId);
					return;
				}
				ctx.uiWorkspace.openSession({
					parentSessionId,
					childSessionId,
					mode: "continuable"
				});
			}, openPluginManager };
			// C21.3：配置只有一份（宿主 volatile Config）；这里只造一个读写把手，构造失败也只降级。
			const configController = createConfigController(ctx, openPluginManager);
			ctx.effect(() => () => configController.dispose(), "@local/dsh-team-workflow: config form");
			ctx.slots.inject(SLOT_NAME, () => {
				try {
					return ctx.slots.register({
						name: SLOT_NAME,
						id: OFFICIAL_SLOT_ID,
						order: -20,
						priority: SHADOW_PRIORITY,
						locale: NS,
						inject: () => ({ ...actions, config: configController })
					}, TeamAction);
				} catch (error) {
					// 官方若用同一个 id 且 priority 相同占位，register 会抛 "already has an entry with id"。
					// 这不是故障：C1 要求官方优先，此处让位即可。异常绝不能冒出去——
					// 客户端 entry 抛错会让 Web 外壳的启动激活审计在 mount 之前 throw，
					// 整个 GUI 停在 "Failed to load plugins"（第一版就是这个死法）。
					return () => {};
				}
			});

			// C20.2：本组合包详情页的区块（卡片 locale meta 只有一句话，结构化内容在这里）。
			// 槽位由官方管理器页面声明（list / scope root），按页面传入的 subject 渲染。
			ctx.slots.inject("plugins.detail.section", () => {
				try {
					return ctx.slots.register({
						name: "plugins.detail.section",
						id: "team-workflow-roles",
						locale: NS
					}, TeamWorkflowDetailSection);
				} catch (error) {
					// 与卡片同理：注册失败只能让位，绝不能冒出去（整页会停在 Failed to load plugins）。
					return () => {};
				}
			});
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Browser entry registering the Agent Teams conversation-header action. */
		/**
		* Register the Team locale dictionaries and header action on the Client Context.
		* @param ctx - Client Context with the declared `inject` services available.
		*/
		function apply(ctx) {
			registerAgentTeamUi(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map