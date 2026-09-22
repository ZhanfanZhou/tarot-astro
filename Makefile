SHELL := /bin/bash
PROXY ?= http://127.0.0.1:7890
PYTHON ?= python3
export PROXY

.PHONY: dev backend frontend install clean

## 启动前清理本项目旧服务；Ctrl+C / TERM / HUP 时停止所有子进程
## 任一服务退出，也会停止另一服务。强制杀死管理器后可用 make clean 恢复。
dev backend frontend:
	@$(PYTHON) scripts/dev.py $@

## 安装依赖
install:
	$(PYTHON) -m venv venv
	venv/bin/python -m pip install -r requirements.txt
	cd frontend && npm install

## 只清理确认属于本项目的 8000 / 5173 服务及其子进程
clean:
	@$(PYTHON) scripts/dev.py clean
