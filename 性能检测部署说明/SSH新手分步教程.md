# JaceCanvas 性能检测：SSH 新手分步教程

这份教程只解决一件事：让 Windows 桌面版通过 SSH 读取服务器的 CPU、内存、磁盘、GPU 和 ComfyUI 状态。它不会替你安装模型，也不会让没有显卡的服务器凭空显示 GPU。

## 先看结论

- **无 NVIDIA 显卡**：可以显示 CPU、内存、磁盘和 ComfyUI；GPU、显存、温度显示 `--` 是正常的。
- **有 NVIDIA 显卡**：服务器必须安装正常的 NVIDIA 驱动，并且登录用户执行 `nvidia-smi` 有输出。
- **不需要为了性能条安装 CUDA**。
- SSH 账号只需要能执行只读命令，不建议为了这项功能使用 root。

## 第 1 步：准备你需要的信息

向服务器提供商或管理员确认以下 5 项：

1. 服务器地址，例如 `203.0.113.10`；
2. SSH 端口，默认是 `22`，云服务器可能是其他端口；
3. SSH 用户名，例如 `ubuntu`、`root` 或服务商分配的用户；
4. 登录密码，或已经配置好的 SSH 密钥；
5. 服务器是否有 NVIDIA 显卡。

不要把真实密码、API Key 写进项目文件、截图或发给别人。

## 第 2 步：在服务器上检查命令

先用 SSH 登录服务器，然后逐行执行：

```bash
command -v sshd || true
command -v top || true
command -v free || true
command -v df || true
command -v nvidia-smi || true
```

正常情况是 `top`、`free`、`df` 能找到路径。没有 NVIDIA 显卡时，`nvidia-smi` 没有输出可以忽略。

有显卡时继续执行：

```bash
nvidia-smi
```

如果能看到 GPU 名称、驱动版本和显存，说明 GPU 查询条件满足。如果提示 `command not found` 或驱动错误，不要先改桌面端，先让服务器管理员修复驱动。

## 第 3 步：Ubuntu / Debian 开启 SSH

如果你已经能 SSH 登录，可以跳过这一步。只能通过服务器控制台操作时，以 Ubuntu/Debian 为例：

```bash
sudo apt update
sudo apt install -y openssh-server procps
sudo systemctl enable --now ssh
sudo systemctl status ssh --no-pager
```

看到 `active (running)` 表示 SSH 服务正在运行。

## 第 4 步：CentOS / Rocky / AlmaLinux 开启 SSH

```bash
sudo dnf install -y openssh-server procps-ng
sudo systemctl enable --now sshd
sudo systemctl status sshd --no-pager
```

看到 `active (running)` 后继续下一步。

## 第 5 步：检查服务器端口

在服务器执行：

```bash
sudo ss -lntp | grep ':22 '
```

如果实际端口不是 22，请把命令里的 22 换成实际端口。还要在云厂商安全组/防火墙中放行该 SSH 端口，但只允许你的 Windows 公网 IP 更安全。

## 第 6 步：先在 Windows 测试，别急着打开软件

打开 Windows PowerShell，执行：

```powershell
Test-NetConnection 服务器地址 -Port SSH端口
ssh -p SSH端口 用户名@服务器地址
```

例如：

```powershell
Test-NetConnection 203.0.113.10 -Port 22
ssh -p 22 ubuntu@203.0.113.10
```

第一次连接可能会询问是否接受指纹，确认地址无误后输入 `yes`。随后输入密码。密码输入时屏幕不会显示字符，这是 SSH 的正常行为，输入完成直接按回车。

如果 `TcpTestSucceeded` 是 `False`，先检查地址、端口、安全组和防火墙；如果能连通但密码失败，检查用户名和密码，不要反复修改桌面端。

## 第 7 步：在 JaceCanvas 中填写

1. 打开 JaceCanvas 4.6.2；
2. 打开 **设置 → 连接设置**；
3. 填写主控 API 地址；
4. 在 SSH 连接命令中填写：

   ```text
   ssh -p SSH端口 用户名@服务器地址
   ```

5. 填写 SSH 密码；
6. 点击保存；
7. 等待性能条刷新，首次连接可能需要十几秒。

密码由桌面版的安全存储处理，不要把密码填入命令文本，也不要把命令保存到公开文档。

## 第 8 步：如何判断成功

- `SSH 实时`：CPU/内存等数据来自服务器 SSH；
- `HTTP 在线`：SSH 没成功，但主控回退接口返回了状态；
- `离线`：两种方式都没有拿到数据；
- GPU 显示 `--`：服务器没有可用 NVIDIA GPU，或 `nvidia-smi` 对当前用户不可用；
- ComfyUI 未运行：SSH 可能正常，只是 ComfyUI 进程没有启动。

## 常见问题排查顺序

1. PowerShell 的 `Test-NetConnection` 是否成功；
2. `ssh -p ... 用户名@地址` 是否能登录；
3. 登录后 `top`、`free`、`df` 是否存在；
4. 有显卡时 `nvidia-smi` 是否有输出；
5. JaceCanvas 中端口、用户名、地址是否与测试命令完全一致；
6. 等待一次完整刷新，或重启桌面版后再看。

如果服务器只能通过跳板机访问，请先建立本地端口转发，再在 JaceCanvas 中填写 `127.0.0.1` 和本地转发端口。不要把跳板机密码写进项目。