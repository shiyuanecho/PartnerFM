#!/usr/bin/env python3
"""Seegent — 向后兼容入口。直接运行 python3 server.py 仍可启动。"""

from seegent.server import run_server

if __name__ == '__main__':
    run_server(open_browser=True)
