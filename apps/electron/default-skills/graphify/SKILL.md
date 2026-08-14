---
name: graphify
description: 代码知识图谱查询（依赖关系、影响面、代码结构）。当需要理解代码库结构、查某个符号/文件的调用与依赖关系、评估改动影响面、或找相关代码时使用；用 Bash 执行 graphify query/explain/path 命令，返回带行号与置信标签（EXTRACTED/INFERRED）的图结构。
version: "1.1.0"
---

# Graphify 代码知识图谱查询

通过已构建的代码知识图谱（graphify）查询代码结构，比反复 grep 文件更精准。

## 前置条件

- 图谱已构建：主仓库 `graphify-out/graph.json` 存在
- 主仓库路径：worktree 会话需解析主仓库（`git rev-parse --path-format=absolute --git-common-dir` 的父目录），图谱建在主仓库而非当前 worktree

## 命令模板

```bash
# 找相关代码（自然语言 → 图遍历子图）
graphify query "<问题>" --graph "<主仓库>/graphify-out/graph.json"

# 查符号/文件关系（每条边带行号 + EXTRACTED/INFERRED 置信标签）
graphify explain "<符号或文件名>" --graph "<主仓库>/graphify-out/graph.json"

# 查两节点影响路径（A 如何影响 B）
graphify path "<A>" "<B>" --graph "<主仓库>/graphify-out/graph.json"

# 增量刷新（代码变更后）
cd <主仓库> && graphify update .
```

## 使用场景

- **改代码前查影响面**：`graphify explain <目标文件>` 看谁引用它（入边）
- **理解陌生模块**：`graphify query "<模块功能描述>"`
- **审查改动**：`graphify explain <改动文件>` 看引用与被引用关系
- **依赖溯源**：`graphify path <A> <B>`

## 注意

- `--graph` 必须传**主仓库**的 graph.json 路径（worktree 会话不要传 worktree 路径）
- 图谱可能不完整（增量更新滞后），关键判断仍需 Read/Grep 核实
- graphify 未安装时提示用户：可在设置 → 代码图谱环境一键安装
