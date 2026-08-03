# JaceCanvas 性能显示 · 新手分步教程

> 适用于 JaceCanvas 桌面版 **4.6.8**。这份教程面向**完全没有服务器经验的小白用户**，一步一步教你把窗口底部的「性能条」用起来。

---

## 一、性能条能显示什么？

窗口底部有一根实时状态条（性能条），显示你远程 GPU 服务器的运行情况：

| 指标 | 说明 | 有卡模式 | 无卡模式 |
|---|---|---|---|
| 连接状态 | SSH 实时 / HTTP 在线 / 离线 | ✅ | ✅ |
| 执行中 / 排队中 | ComfyUI 正在跑的任务数 | ✅ | ✅ |
| GPU 使用率 | 显卡占用百分比 | ✅ | ❌ 显示 `--` |
| 显存（VRAM） | 显卡内存 | ✅ | ❌ 显示 `--` |
| CPU 使用率 | 处理器占用百分比 | ✅ | ✅ |
| 内存（RAM） | 服务器内存 | ✅ | ✅ |
| 温度 | GPU 温度 | ✅ | ❌ 显示 `--` |
| ComfyUI 状态 | 运行中 / 未运行 | ✅ | ✅ |

> ⚠️ **无卡模式说明（重要）**
>
> 如果你的服务器是「**无卡模式**」（没有 NVIDIA 显卡，或显卡驱动不可用），那么 **GPU、显存、温度会显示为 `--`**。
> 这是**正常现象，不是软件故障，也不影响生成功能**。
> 你仍然可以看到 CPU、内存、磁盘、ComfyUI 状态和任务数量。

---

## 二、服务器端需要做什么（约 5 分钟）

你的服务器只需要满足两个条件，**不需要安装任何 JaceCanvas 后端**：

1. **能通过 SSH 登录**（很多 GPU 云平台默认开启，如 AutoDL、Vast.ai 等）
2. **系统有 `top`、`free`、`df` 这三个基础命令**（Linux 系统基本都有）

### 2.1 检查命令是否可用

在服务器的命令行（终端）里依次输入下面三行，每行回车：

```bash
command -v top || echo "缺少 top"
command -v free || echo "缺少 free"
command -v df || echo "缺少 df"
```

- 如果都**没有输出 "缺少 xxx"**，说明三个命令都在，**服务器端就准备完成了** ✅
- 如果提示缺少某命令，在 Ubuntu/Debian 系统执行：`sudo apt install -y procps`

### 2.2 如果服务器还没有 SSH 服务（很少见）

Ubuntu / Debian：

```bash
sudo apt update
sudo apt install -y openssh-server
sudo systemctl enable --now ssh
```

CentOS / Rocky：

```bash
sudo dnf install -y openssh-server
sudo systemctl enable --now sshd
```

### 2.3 关于显卡驱动（无卡模式跳过）

- **有卡模式**：确保能执行 `nvidia-smi`（`nvidia-smi` 回车能看到显卡信息）。
- **无卡模式**：什么都不用做。即使 `nvidia-smi` 报错或显示 Permission denied，也不影响 CPU/内存检测。

> 不要为了性能显示专门安装 CUDA。性能检测只读取显卡驱动自带的 `nvidia-smi` 输出；无卡服务器不需要这个命令。

---

## 三、Windows 电脑端需要做什么（约 10 分钟）

### 3.1 安装 Python（如果没装过）

1. 打开官网 <https://www.python.org/downloads/>，下载 Windows 安装包；
2. 双击安装，**务必勾选**「Add python.exe to PATH」；
3. 装完后，在 Windows 开始菜单搜「PowerShell」，打开后输入：

```powershell
python --version
```

看到 `Python 3.x` 就说明安装成功。

### 3.2 安装 Paramiko（SSH 连接库）

在刚才的 PowerShell 里输入：

```powershell
python -m pip install paramiko
```

看到 `Successfully installed paramiko` 就成功。

> 如果提示 `pip 不是内部或外部命令`，说明 Python 没加入 PATH，请重新安装并勾选「Add to PATH」。

### 3.3 在 JaceCanvas 里填写服务器信息

1. 打开 JaceCanvas → 右上角 ⚙ **设置** → **连接设置**；
2. 填写你的服务器信息（以 AutoDL 为例）：

| 配置项 | 填写内容 |
|---|---|
| 主控 API 地址 | 云平台给的**根地址**（如 `https://xxx.westd.seetacloud.com:8443/`） |
| SSH 连接命令 | 云平台给的命令，直接整段粘贴（示例：`ssh -p <端口> <用户名>@<服务器地址>`） |
| SSH 密码 | 云平台给的密码 |

3. 点击「保存连接设置」。

### 3.4 保存后看效果

保存后约 5～20 秒，窗口底部性能条会开始刷新：

- 显示 **SSH 实时** → 连接成功，数据来自服务器 ✅
- 显示 **HTTP 在线** → SSH 没连上，但主控接口有响应（也能看 CPU/内存）
- 显示 **离线** → 都没连上，见下方常见问题

---

## 四、常见问题（小白排查）

**Q1：性能条一直显示「离线」？**
依次检查：
1. 设置里的 SSH 连接命令和密码是否复制完整（注意端口和用户名）；
2. Windows 能否访问服务器 SSH 端口（云平台需要放行安全组/防火墙）；
3. 在 PowerShell 测试：`Test-NetConnection 服务器地址 -Port 端口`，返回 `TcpTestSucceeded : True` 才通。

**Q2：GPU 显示 `--`，是不是坏了？**
不是。说明服务器是**无卡模式**，或显卡驱动不可用。这是正常现象，不影响生成。CPU、内存、ComfyUI 状态正常显示即可。

**Q3：提示「找不到 Python 或 Paramiko」？**
回到 3.1 和 3.2 安装。如果已安装仍提示，把 Python 目录加入系统 PATH 后重启 JaceCanvas。

**Q4：显示「SSH/性能检测失败」？**
鼠标悬停在红色提示上会显示具体原因，重点检查：地址、端口、用户名、密码、服务器是否允许密码登录。

**Q5：SSH 连上了但很慢？**
SSH 首次握手需要几秒到十几秒，属正常；之后每 5 秒刷新一次。

---

## 五、安全提醒

- **不要把真实的 SSH 地址、密码、API Key 写进任何文档、截图、日志或 GitHub**；
- 生产环境建议使用最小权限账号，并限制 SSH 来源 IP；
- 如果凭据曾经出现在公开地方，请立即在云平台重置密码/密钥；
- 本软件不会把你的 SSH 密码上传到任何第三方服务，只保存在本机系统安全存储中。
