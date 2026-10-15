# 台账：协议测试记录（归档，字节等同被归档文件）
# 时间: 2026-10-13T09:29:55Z
# 说明: Lead 在跑 E2E 协议用例时，同一个 tu-e2e-l3 payload 被执行了两次，
#       产生重复 dispatch 记录；ledger.js --verify 正确报出 ok=false + duplicate_dispatch_ids。
#       这证明校验器非空转。测试记录已归档为 evidence/ledger-protocol-test.jsonl，
#       活动台账保留原始字节副本后清空，用于记录真实派发。
# --verify 对该归档的输出:
{"ok":false,"tool":"dsh-team-ledger-verify","path":"/Users/maxwell/Documents/deepseek-harness/default-workspace/dsh-team-workflow/evidence/ledger-protocol-test.jsonl","exists":true,"lines":3,"records":3,"dispatch_records":3,"complete_records":0,"max_seq":3,"malformed_lines":[],"seq_issues":[],"ts_issues":[],"duplicate_dispatch_ids":[{"line":3,"task_id":"session-57424633-e0c0-4f51-89ba-62f90af47e72#tu-e2e-l3","first_line":2}],"bad_source":[],"unknown_event":[]}
# 活动台账现状: 0 条
