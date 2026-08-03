#!/usr/bin/env bash
# 只读检查脚本：不安装软件、不修改服务、不写入配置。
set -u
echo '__JACECANVAS_CHECK__'
printf 'host='; hostname 2>/dev/null || true
printf 'os='; . /etc/os-release 2>/dev/null && printf '%s\n' "${PRETTY_NAME:-unknown}" || true
printf 'ssh='; command -v sshd 2>/dev/null || true
printf 'nvidia-smi='; command -v nvidia-smi 2>/dev/null || true
printf 'top='; command -v top 2>/dev/null || true
printf 'free='; command -v free 2>/dev/null || true
printf 'df='; command -v df 2>/dev/null || true
echo '__GPU__'
nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || echo 'no-nvidia-gpu'
echo '__CPU__'
top -bn1 2>/dev/null | grep -E 'Cpu\(s\)|%Cpu' | head -1 || true
echo '__MEM__'
free -b 2>/dev/null || true
echo '__DISK__'
df -BG / 2>/dev/null || true