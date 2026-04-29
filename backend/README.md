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

## 分支命名规范

分支命名应遵循以下格式：

```
<type>/<description>
```

### 分支类型 (Type)

- **feat**: 用于开发新功能（例如：`feat/user-login`）
- **fix**: 用于修复常规 Bug（例如：`fix/api-timeout`）
- **hotfix**: 用于修复生产环境紧急 Bug（例如：`hotfix/payment-crash`）
- **docs**: 用于编写或更新文档（例如：`docs/api-guide`）
- **refactor**: 用于代码重构（例如：`refactor/auth-module`）
- **release**: 用于准备发布新版本（例如：`release/v1.2.0`）

### 命名规则

1. 推荐使用全小写字母。
2. 单词之间使用短横线 `-` 连接。
3. 描述（description）应简明扼要，能够清晰表达该分支的目的。

### 示例

- `feat/add-payment-gateway`
- `fix/login-page-layout`
- `hotfix/security-vulnerability-patch`
