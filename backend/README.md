# Git Commit 规范

本项目采用 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) 规范进行提交。

## 格式

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

## 提交类型 (Type)

- **feat**: 新功能 (Feature)
- **fix**: 修复 Bug (Bug Fix)
- **docs**: 文档修改 (Documentation)
- **style**: 代码格式修改（不影响代码运行的变动，如空格、格式化、缺失的分号等）
- **refactor**: 代码重构（既不是新增功能，也不是修改 Bug 的代码变动）
- **perf**: 性能优化 (Performance)
- **test**: 增加或修改测试用例 (Test)
- **build**: 影响构建系统或外部依赖的更改（如 pip, poetry）
- **ci**: 对 CI/CD 配置文件和脚本的更改（如 GitHub Actions）
- **chore**: 其他不修改源代码或测试文件的更改（如构建过程或辅助工具的变动）
- **revert**: 撤销之前的提交 (Revert)

## 示例

- `feat(api): 添加用户注册接口`
- `fix(auth): 修复登录时密码验证失败的问题`
- `docs(readme): 更新提交规范说明`
