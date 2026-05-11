# 后端项目启动步骤

本文档用于启动当前后端项目：

```txt
E:\熠朵科技\cultural-relics-museum-hm-backend
```

当前项目使用：

- Python 3.12.7
- FastAPI
- OpenAI Python SDK 调用 MiniMax
- `.venv` 作为项目虚拟环境

---

## 1. 进入项目目录

打开 PowerShell，进入当前后端项目目录：

```powershell
cd E:\熠朵科技\cultural-relics-museum-hm-backend
```

---

## 2. 创建虚拟环境

如果项目里还没有 `.venv`，执行：

```powershell
python -m venv .venv
```

如果已经存在 `.venv`，跳过这一步。

---

## 3. 激活虚拟环境

```powershell
.\.venv\Scripts\Activate.ps1
```

激活后，命令行前面通常会出现：

```txt
(.venv)
```

如果同时看到：

```txt
(.venv) (base)
```

说明 Anaconda 的 base 环境仍然开着。一般不影响运行，但为了避免 `python` 指向 Anaconda，后续命令建议优先使用虚拟环境里的完整解释器路径：

```powershell
.\.venv\Scripts\python.exe
```

---

## 4. 检查 Python 版本

推荐使用完整路径检查：

```powershell
.\.venv\Scripts\python.exe --version
```

期望输出：

```txt
Python 3.12.7
```

如果输出不是 `Python 3.12.7`，删除 `.venv` 后重新创建虚拟环境。

---

## 5. 安装依赖

第一次启动项目时，安装依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

如果 `requirements.txt` 还不存在，使用下面的基础依赖安装命令：

```powershell
.\.venv\Scripts\python.exe -m pip install fastapi "uvicorn[standard]" pydantic-settings python-dotenv httpx openai sqlalchemy alembic aiosqlite python-multipart
```

安装或更新依赖后，重新生成依赖文件：

```powershell
.\.venv\Scripts\python.exe -m pip freeze > requirements.txt
```

---

## 6. 配置环境变量

项目根目录需要有 `.env` 文件。

最小配置：

```env
APP_NAME=cultural-relics-museum-backend
APP_ENV=development
DATABASE_URL=sqlite+aiosqlite:///./museum.db
```

如果要测试 MiniMax，还需要配置：

```env
MINIMAX_API_KEY=你的_MINIMAX_API_KEY
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_MODEL=MiniMax-M2.7
```

注意：不要把真实 API Key 提交到 Git。

---

## 7. 测试 MiniMax 调用

项目里已有测试脚本：

```txt
test_minimax.py
```

运行：

```powershell
.\.venv\Scripts\python.exe test_minimax.py
```

如果成功，会输出 MiniMax 的回答。

如果报错：

```txt
MINIMAX_API_KEY is not set
```

说明 `.env` 里没有配置 `MINIMAX_API_KEY`，或当前命令不是在项目根目录执行。

如果报错：

```txt
No module named openai
```

说明依赖没有安装到 `.venv`，执行：

```powershell
.\.venv\Scripts\python.exe -m pip install openai python-dotenv
```

---

## 8. 启动 FastAPI 服务

当前入口文件：

```txt
app/main.py
```

启动服务：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

启动成功后，访问：

```txt
http://127.0.0.1:8000/api/health
```

期望返回：

```json
{
  "data": {
    "status": "ok"
  }
}
```

接口文档地址：

```txt
http://127.0.0.1:8000/docs
```

---

## 9. 日常启动流程

以后每天开发时，一般只需要执行：

```powershell
cd E:\熠朵科技\cultural-relics-museum-hm-backend
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

如果只是测试 MiniMax：

```powershell
cd E:\熠朵科技\cultural-relics-museum-hm-backend
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe test_minimax.py
```

---

## 10. 常见问题

### 10.1 `python` 指向了 Anaconda

如果看到类似：

```txt
E:\anaconda3\python.exe
```

说明当前 `python` 没有使用 `.venv`。

解决方式：直接使用完整路径：

```powershell
.\.venv\Scripts\python.exe
```

例如：

```powershell
.\.venv\Scripts\python.exe -m pip install openai
.\.venv\Scripts\python.exe test_minimax.py
```

### 10.2 不要写错 `-m pip`

正确：

```powershell
.\.venv\Scripts\python.exe -m pip install -U pip
```

错误：

```powershell
.\.venv\Scripts\python.exe -m python -m pip install -U pip
```

`-m` 后面应该直接跟模块名，例如 `pip`、`uvicorn`。

### 10.3 PowerShell 阻止激活脚本

如果激活 `.venv` 时报执行策略错误，临时执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

这个设置只对当前 PowerShell 窗口生效。

### 10.4 端口 8000 被占用

可以换一个端口启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

然后访问：

```txt
http://127.0.0.1:8001/docs
```
