/*
 * 本文件**不是重新实现**：外壳逐字取自官方
 * @deepseek-ai/dsh-experimental-client-ui-agent-team 的客户端 bundle
 * （官方完整样式表、面板、portal、useAnchoredPosition 定位、悬停展开、Esc 关闭、
 *  aria/role、中英文案 全部原样保留）。
 *
 * 改动的只有**内容层**，因为本工作流的实质是「特定角色与明确产物」，
 * 而官方那套是通用的「任意成员 + 通用任务板」：
 *
 *   A. 数据来源：官方读 Lead Session 的 agentTeam 投影；
 *      这里换成资源包 sources/omp/agents/*.md 定义的 10 个角色（经 roles.json 内联）。
 *   B. 角色行：官方 TeamMemberRow 展示 名称/运行状态/模型；
 *      这里改为展示 职责 / 产物 / 边界 / 能力 / 技能，并显式标出悬空技能。
 *
 * 由 _tools/copy-official-client.js 自动生成，可重复执行；锚点对不上会报错而不是静默出错。
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
		//#region \0dsh-css:/Users/hrsonion/Developer/harness/dsh-macos-arm64/packages/experimental/client-ui-agent-team/src/client/TeamAction.module.css.mjs
		const css = "._2tNPVa_root{position:relative}._2tNPVa_trigger{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:5px;padding:3px 7px;font-size:12px;display:inline-flex}._2tNPVa_trigger:hover,._2tNPVa_trigger:focus-visible{color:var(--dsw-alias-label-primary)}@container (width<=480px){._2tNPVa_triggerLabel{display:none}}._2tNPVa_count{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;font-size:12px;font-weight:400;line-height:16px}._2tNPVa_panel{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);z-index:100;box-sizing:border-box;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:min(500px,100vw - 32px);max-height:min(680px,100vh - 32px);box-shadow:var(--dsw-elevation-prominent);border:0;border-radius:12px;flex-direction:column;padding:8px 2px 0;display:flex;position:fixed;overflow:hidden}._2tNPVa_panel:before{content:\"\";z-index:-1;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);border-radius:12px;position:absolute;inset:0}._2tNPVa_panelCompact{width:min(320px,100vw - 32px)}._2tNPVa_panelCompact ._2tNPVa_roster{grid-template-columns:minmax(0,1fr)}._2tNPVa_body{--dsh-scrollbar-track-margin:8px;scrollbar-gutter:stable;flex:auto;min-height:0;padding:0 9px 16px 14px;overflow-y:auto}._2tNPVa_taskTitle{align-items:center;gap:8px;display:flex}._2tNPVa_taskTitle strong{font-size:13px;font-weight:500}._2tNPVa_panel h3{color:var(--dsw-alias-label-primary);align-items:center;gap:8px;margin:16px 0 8px 4px;font-size:13px;font-weight:500;display:flex}._2tNPVa_body section:first-of-type h3{margin-top:8px}._2tNPVa_roster{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;display:grid}._2tNPVa_member{--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);min-width:0;box-shadow:var(--dsw-elevation-stroke);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;border:0;border-radius:8px;align-items:flex-start;gap:8px;padding:10px 12px;display:flex}._2tNPVa_member:disabled{cursor:default}._2tNPVa_memberCurrent{--dsw-elevation-stroke-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent);box-shadow:var(--dsw-elevation-stroke), inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent)}._2tNPVa_member:not(:disabled):hover,._2tNPVa_member:not(:disabled):focus-visible{--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel)}._2tNPVa_memberDot{flex:none;align-items:center;height:1lh;display:inline-flex}._2tNPVa_inactiveIcon{color:var(--dsw-alias-label-tertiary)}._2tNPVa_memberText{flex-direction:column;min-width:0;display:flex}._2tNPVa_memberName{align-items:center;gap:5px;min-width:0;display:inline-flex}._2tNPVa_memberNameText,._2tNPVa_memberText small{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}._2tNPVa_memberModel{display:none}._2tNPVa_member:hover ._2tNPVa_memberModel,._2tNPVa_member:focus-visible ._2tNPVa_memberModel{display:inline}._2tNPVa_currentTag{text-overflow:ellipsis;flex:0 999 auto;min-width:0;padding:0 4px;font-size:10px;line-height:15px;display:inline-block;overflow:hidden}._2tNPVa_memberText small,._2tNPVa_meta{color:var(--dsw-alias-label-tertiary);font-size:11px}._2tNPVa_diagnostic,._2tNPVa_error,._2tNPVa_warning{color:var(--dsw-alias-state-error-primary)}._2tNPVa_tasks{flex-direction:column;gap:7px;display:flex}._2tNPVa_emptyNotice{color:var(--dsw-alias-label-tertiary);margin:16px 0 0 4px;font-size:12px}._2tNPVa_task{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:9px;padding:11px 13px}._2tNPVa_taskState{color:var(--dsw-alias-label-tertiary);align-items:center;gap:6px;margin-left:auto;font-size:11px;display:inline-flex}._2tNPVa_task p{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;margin:5px 0;font-size:12px;line-height:18px}._2tNPVa_clampedDescription{-webkit-line-clamp:2;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}._2tNPVa_expandToggle{float:right;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;align-items:center;gap:2px;margin-left:10px;padding:0;font-size:11px;line-height:20px;display:inline-flex}._2tNPVa_expandToggle:hover,._2tNPVa_expandToggle:focus-visible{color:var(--dsw-alias-label-primary)}._2tNPVa_expandToggle svg{transition:transform .12s}._2tNPVa_expandToggleOpen{transform:rotate(180deg)}._2tNPVa_meta{line-height:20px}._2tNPVa_meta>span{margin-right:10px}._2tNPVa_notice,._2tNPVa_error{align-items:center;gap:6px;padding:9px;font-size:12px;display:flex}";
		const ROLE_CSS = "._2tNPVa_memberText{flex:1}._2tNPVa_member ._2tNPVa_roleDuty,._2tNPVa_member ._2tNPVa_roleLine{white-space:normal;overflow:visible;text-overflow:clip;line-height:16px}._2tNPVa_roleDuty{color:var(--dsw-alias-label-secondary)}._2tNPVa_roleLabel{font-weight:500;margin-right:5px;color:var(--dsw-alias-label-tertiary)}";
		const tagId = "@local/dsh-team-workflow/TeamAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-experimental-client-ui-agent-team";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css + ROLE_CSS;
			document.head.appendChild(tag);
		}
		var TeamAction_module_css_default = {
			"body": "_2tNPVa_body",
			"clampedDescription": "_2tNPVa_clampedDescription",
			"count": "_2tNPVa_count",
			"currentTag": "_2tNPVa_currentTag",
			"diagnostic": "_2tNPVa_diagnostic",
			"emptyNotice": "_2tNPVa_emptyNotice",
			"error": "_2tNPVa_error",
			"expandToggle": "_2tNPVa_expandToggle",
			"expandToggleOpen": "_2tNPVa_expandToggleOpen",
			"inactiveIcon": "_2tNPVa_inactiveIcon",
			"member": "_2tNPVa_member",
			"memberCurrent": "_2tNPVa_memberCurrent",
			"memberDot": "_2tNPVa_memberDot",
			"memberModel": "_2tNPVa_memberModel",
			"memberName": "_2tNPVa_memberName",
			"memberNameText": "_2tNPVa_memberNameText",
			"memberText": "_2tNPVa_memberText",
			"meta": "_2tNPVa_meta",
			"notice": "_2tNPVa_notice",
			"panel": "_2tNPVa_panel",
			"panelCompact": "_2tNPVa_panelCompact",
			"root": "_2tNPVa_root",
			"roster": "_2tNPVa_roster",
			"task": "_2tNPVa_task",
			"taskState": "_2tNPVa_taskState",
			"taskTitle": "_2tNPVa_taskTitle",
			"tasks": "_2tNPVa_tasks",
			"trigger": "_2tNPVa_trigger",
			"triggerLabel": "_2tNPVa_triggerLabel",
			"warning": "_2tNPVa_warning"
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
		 * 角色行：展示该角色的职责、产物、边界、能力与技能。
		 * 沿用官方 .member 卡片类与视觉；用 disabled 按钮取 .member:disabled 的默认光标，
		 * 因为没有“打开成员会话”这种导航动作（角色按需实例化，不是常驻会话）。
		 */
		function TeamMemberRow({ member, t }) {
		 const jsx = react_jsx_runtime.jsx;
		 const jsxs = react_jsx_runtime.jsxs;
		 const css = TeamAction_module_css_default;
		 const P = _deepseek_ai_dsh_client_ui_primitives;
		 const dangling = member.danglingSkills ?? [];
		 return jsx(P.Tooltip, {
		  label: "技能：" + member.autoloadSkills.join("、"),
		  side: "bottom",
		  gap: 4,
		  children: jsxs("button", {
		   type: "button",
		   disabled: true,
		   className: css.member,
		   children: [jsx("span", {
		    className: css.memberDot,
		    children: jsx(P.IconUserOutlineRegular, { size: 14, className: css.inactiveIcon })
		   }), jsxs("span", {
		   className: css.memberText,
		   children: [
		    jsxs("span", { className: css.memberName, children: [
		     jsx("span", { className: css.memberNameText, children: member.name }),
		     jsx(P.Tag, { tone: "info", className: css.currentTag, children: member.id })
		    ] }),
		    jsx("small", { className: css.roleDuty, children: member.duty }),
		    jsxs("small", { className: css.roleLine, children: [
		     jsx("b", { className: css.roleLabel, children: t("outputs") }),
		     member.outputs.join(" · ")
		    ] }),
		    jsxs("small", { className: css.roleLine, children: [
		     jsx("b", { className: css.roleLabel, children: t("boundaries") }),
		     member.boundaries
		    ] }),
		    jsxs("small", { className: css.roleLine, children: [
		     jsx("b", { className: css.roleLabel, children: t("capability") }),
		     (member.writable ? t("writable") : t("readonly")) + " · " + member.tools.join(", ")
		      + " · " + member.autoloadSkills.length + " 技能"
		    ] }),
		    dangling.length > 0 && jsx("small", { className: css.diagnostic, children:
		     "⚠ " + t("dangling") + "：" + dangling.join("、") })
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
		 * 本工作流的角色名册——来自资源包 sources/omp/agents/*.md（经 roles.json 内联），
		 * 不是通用的“任意成员”列表。model 别名只作角色映射，不含凭据。
		 */
		const WORKFLOW_ROLES = [{"id":"pm","title":"产品经理","duty":"把用户意图转成有范围、可测的产品需求与验收标准。","outputs":["PRD 草稿","用户流","明确的非目标","优先级","验收标准","未决问题"],"boundaries":"不改代码、不选技术架构、不批准例外、不直接联系用户。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","product-delivery","pm-requirements","cross-team-contract-alignment","hermes-obsidian"],"danglingSkills":[]},{"id":"architect","title":"架构师","duty":"设计技术边界、契约与 ADR 草案，但不实现它们。","outputs":["可实施的技术方案","接口契约","所有权边界","ADR 影响分析"],"boundaries":"不改实现、不擅自修订生效 ADR、不批准例外；重大架构变更须经主 Agent 以 needs-authorization 上报。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","architecture-delivery","cross-team-contract-alignment","database-design-checklist","web-architecture-patterns","hermes-obsidian"],"danglingSkills":[]},{"id":"backend","title":"后端","duty":"仅在指派路径与契约内实现已批准的后端与数据层工作。","outputs":["变更路径","验证证据","风险","所需的下一道门"],"boundaries":"不改架构 / CI-CD / 生产部署文件 / 密钥，不改自己的评审状态；schema 与迁移按串行共享所有权处理。","tools":["read","grep","glob","edit","write","bash","lsp"],"writable":true,"autoloadSkills":["team-workflow","backend-delivery","database-design-checklist","web-architecture-patterns","hermes-obsidian"],"danglingSkills":[]},{"id":"frontend","title":"前端","duty":"仅在指派路径与契约内实现已批准的前端工作。","outputs":["变更路径","验证证据","风险","所需的下一道门"],"boundaries":"保持后端与共享 schema 契约；不改架构、受保护部署文件、密钥或自己的评审状态。","tools":["read","grep","glob","edit","write","bash","lsp"],"writable":true,"autoloadSkills":["team-workflow","frontend-delivery","react-best-practices","hermes-obsidian"],"danglingSkills":["react-page-implementation"]},{"id":"harness","title":"智能体","duty":"在指派路径内实现已批准的 agent 运行时、模型、提示、工具、MCP 与编排改动。","outputs":["变更路径","被实际执行的行为","风险","所需的下一道门"],"boundaries":"不重定义系统授权、权限模型、跨服务契约或架构；绝不在工件中暴露凭据。","tools":["read","grep","glob","edit","write","bash","lsp"],"writable":true,"autoloadSkills":["team-workflow","harness-delivery","cross-team-contract-alignment","web-architecture-patterns","hermes-obsidian"],"danglingSkills":[]},{"id":"devops","title":"运维","duty":"设计并执行获授权的交付、部署与运行时操作。","outputs":["确切目标环境","不可变工件与完整 Docker 清单","回滚门","命令证据","风险","下一道门"],"boundaries":"未经记录的授权不得操作真实基础设施、密钥、账号、受保护 CI/CD，也不得执行部署/推送/提交；构建、候选、发布、清理四道门相互独立。","tools":["read","grep","glob","edit","write","bash"],"writable":true,"autoloadSkills":["team-workflow","operations-delivery","docker-artifact-safety","hermes-obsidian"],"danglingSkills":[]},{"id":"qa","title":"测试","duty":"独立测试被指派的改动，并报告可复现缺陷而不修复它们。","outputs":["独立推导并执行的测试证据","缺陷（含复现、期望与实际、受影响 revision、严重度、实现 owner）"],"boundaries":"不修改被测实现、不批准自己的证据、不把未执行的测试报告为通过。","tools":["read","grep","glob","bash"],"writable":true,"autoloadSkills":["team-workflow","qa-delivery","verification-before-completion","anti-fake-testing","hermes-obsidian"],"danglingSkills":[]},{"id":"code-review","title":"代码审查","duty":"独立审查实现 diff、证据与交接的正确性与可维护性。","outputs":["发现项（含严重度、受影响路径与行/构造、后果、具体修复建议）"],"boundaries":"不改实现、不自审、不编造测试结果。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","code-review-delivery","code-review-defect-patterns","hermes-obsidian"],"danglingSkills":["branch-diff-static-review"]},{"id":"compliance","title":"合规","duty":"独立评估安全、策略、授权与架构边界的合规性。","outputs":["每条结论归类为 pass / risk / block / needs-authorization 并附具体证据"],"boundaries":"不修改被审实现、不豁免违规、不冒用用户授权。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","compliance-delivery","security-test-matrix","hermes-obsidian"],"danglingSkills":[]},{"id":"quota-control","title":"资源财务","duty":"分析团队用量证据，报告预算、重试与容量异常。","outputs":["事实","数据缺口","阈值突破","建议"],"boundaries":"不取消工作、不改模型、不改预算、不声称未经权威来源提供的测量值。","tools":["read","grep","glob"],"writable":false,"autoloadSkills":["team-workflow","quota-governance","hermes-obsidian"],"danglingSkills":[]}];
		/** 把角色名册适配成官方卡片期望的 team 形状。任务段留空，由工件链说明替代。 */
		function workflowRoster() {
		 return {
		  members: WORKFLOW_ROLES.map((role) => ({
		   id: role.id,
		   name: role.title,
		   duty: role.duty,
		   outputs: role.outputs,
		   boundaries: role.boundaries,
		   tools: role.tools,
		   writable: role.writable,
		   autoloadSkills: role.autoloadSkills,
		   danglingSkills: role.danglingSkills,
		   phase: "active"
		  })),
		  tasks: []
		 };
		}
		function TeamAction({ sessionId, useSession, useSessions, useSessionStatus, openTeammate, t }) {
			const [open, setOpen] = (0, react.useState)(false);
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
			const team = workflowRoster();
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
			const compact = team !== void 0 && team.members.length === 1 && team.tasks.length === 0;
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
								(0, react_jsx_runtime.jsxs)("section", { children: [(0, react_jsx_runtime.jsxs)("h3", { children: [t("roster"), team.members.length > 1 && (0, react_jsx_runtime.jsx)("span", {
									className: TeamAction_module_css_default.count,
									children: team.members.length
								})] }), (0, react_jsx_runtime.jsx)("div", {
									className: TeamAction_module_css_default.roster,
									children: team.members.map((member) => (0, react_jsx_runtime.jsx)(TeamMemberRow, {
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
								(0, react_jsx_runtime.jsx)("section", { children: team.tasks.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
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
		const NS = "agent-team";
		/** Simplified Chinese dictionary and key source. */
		const zh = {
			trigger: "Agent 团队工作流",
			loading: "正在加载团队…",
			unavailable: "Team 暂不可用",
			failure: "团队持久记录无效：{message}",
			empty: "工件链：PRD → ADR（仅持久决策时）→ Tech Spec → 实施计划 → Test Spec → QA 验收报告。按需创建角色，不常驻。",
			roster: "角色分工",
			outputs: "产物",
			boundaries: "边界",
			capability: "能力",
			writable: "可写",
			readonly: "只读",
			dangling: "悬空技能（已移出自动加载）",
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
			roster: "Members",
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
		function registerAgentTeamUi(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "client-ui-agent-team: dictionaries");
			const sessions = ctx.sessions;
			const leadSessionId = (sessionId) => {
				return (sessions.binding(sessionId)?.session.getSnapshot().subagent?.address)?.parentSessionId ?? sessionId;
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
			} };
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "agent-team",
				order: -20,
				locale: NS,
				inject: () => actions
			}, TeamAction));
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